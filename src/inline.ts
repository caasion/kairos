// Inline markdown in item text: Kairos's own small parser.
//
// Task text, block titles and notes are one line of markdown. Rather than run
// Obsidian's MarkdownRenderer (or a CodeMirror editor) on every row, which is
// far too heavy for hundreds of rows, this turns the text into a short list of
// pieces that the views draw directly (ui/inline/InlineText.svelte). It knows:
//
//   [[note]]  [[note|alias]]  ![[embed]] (drawn as a link)
//   [text](url)  [text](Note.md)  bare https:// URLs
//   `code`  **bold**  __bold__  *italic*  _italic_  ~~strike~~  ==highlight==
//   #tag  and backslash escapes
//
// Everything else stays text. It never sees Kairos's own line syntax: the
// parser (parser.ts) has already peeled the time range, the trailing
// [Project] / [D:Domain] associations and the (note) off the line, and a
// "[...]" left in the middle of a title isn't followed by "(" so it stays text.
//
// Results are cached by text, and text with none of the characters that can
// start markup skips parsing, so plain text costs a Map lookup.

export type Inline =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	// `tag` without its "#".
	| { kind: "tag"; tag: string }
	// A link to a note. `target` is the link path as written, with any
	// "#heading" or "#^block" kept and a ".md" dropped.
	| { kind: "internal"; target: string; children: Inline[] }
	| { kind: "external"; url: string; children: Inline[] }
	| { kind: "strong" | "em" | "del" | "mark"; children: Inline[] };

const CACHE_LIMIT = 4000;
const cache = new Map<string, readonly Inline[]>();

// Any of these can start markup. Text without them is one text piece.
const TRIGGER = /[[`*_~=#\\]|:\/\//;

/** The pieces of one line of item text. Cached by text. */
export function parseInline(text: string): readonly Inline[] {
	const hit = cache.get(text);
	if (hit) return hit;
	const pieces: readonly Inline[] = TRIGGER.test(text)
		? parse(text)
		: text
			? [{ kind: "text", text }]
			: [];
	if (cache.size >= CACHE_LIMIT) cache.clear();
	cache.set(text, pieces);
	return pieces;
}

/** Whether the pieces are just text (or nothing), so a view can draw a string. */
export function isPlain(pieces: readonly Inline[]): boolean {
	return pieces.length === 0 || (pieces.length === 1 && pieces[0]!.kind === "text");
}

/** The text the pieces show, without markup: for a drag ghost or a label. */
export function plainText(pieces: readonly Inline[]): string {
	let out = "";
	for (const p of pieces) {
		if (p.kind === "text" || p.kind === "code") out += p.text;
		else if (p.kind === "tag") out += `#${p.tag}`;
		else out += plainText(p.children);
	}
	return out;
}

// ─── the scanner ───────────────────────────────────────────────

// What one position in the text turned into, and where scanning resumes.
interface Atom {
	end: number;
	nodes: Inline[];
}

// ASCII punctuation, which a backslash escapes.
const PUNCT = /[!-/:-@[-`{-~]/;
const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;
// A tag's characters (Obsidian's: letters, numbers, _, -, /). One must be
// something other than a digit.
const TAG = /^#([\p{L}\p{N}\p{M}_\-/]+)/u;
const BARE_URL = /^https?:\/\/[^\s<>]+/i;
// Link schemes a click may open. Anything else (javascript:, file:, data:)
// draws its label as text.
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "obsidian"]);

function parse(s: string): Inline[] {
	const out: Inline[] = [];
	let i = 0;
	let text = "";
	const flush = () => {
		if (text) out.push({ kind: "text", text });
		text = "";
	};
	const take = (nodes: Inline[]) => {
		for (const n of nodes) {
			if (n.kind === "text") text += n.text;
			else {
				flush();
				out.push(n);
			}
		}
	};
	while (i < s.length) {
		const atom = atomAt(s, i) ?? emphasisAt(s, i);
		if (atom) {
			take(atom.nodes);
			i = atom.end;
		} else {
			text += s[i];
			i++;
		}
	}
	flush();
	return out;
}

const literal = (text: string, end: number): Atom => ({ end, nodes: [{ kind: "text", text }] });

// Markup that's read whole and can't contain a closing emphasis marker:
// escapes, code, links, URLs and tags. An emphasis closer is looked for
// around these, never inside them.
function atomAt(s: string, i: number): Atom | undefined {
	const c = s[i];
	if (c === "\\") {
		const next = s[i + 1];
		return next !== undefined && PUNCT.test(next) ? literal(next, i + 2) : undefined;
	}
	if (c === "`") return codeAt(s, i);
	if (c === "!" && s.startsWith("[[", i + 1)) return wikiAt(s, i + 1);
	if (c === "[") return s[i + 1] === "[" ? wikiAt(s, i) : markdownLinkAt(s, i);
	if (c === "#") return tagAt(s, i);
	if (c === "h" || c === "H") return urlAt(s, i);
	return undefined;
}

function runLength(s: string, i: number, c: string): number {
	let n = 0;
	while (s[i + n] === c) n++;
	return n;
}

// `code`, ``code with ` inside``. An unmatched run of backticks is text, read
// whole so a longer run can't be closed by part of it.
function codeAt(s: string, i: number): Atom {
	const run = runLength(s, i, "`");
	let j = i + run;
	while (j < s.length) {
		const k = s.indexOf("`", j);
		if (k < 0) break;
		const r = runLength(s, k, "`");
		if (r === run) {
			let text = s.slice(i + run, k);
			if (text.length > 1 && text.startsWith(" ") && text.endsWith(" ") && text.trim()) {
				text = text.slice(1, -1);
			}
			return { end: k + r, nodes: [{ kind: "code", text }] };
		}
		j = k + r;
	}
	return literal(s.slice(i, i + run), i + run);
}

// [[note]], [[note|alias]], [[note#heading]]. `i` is at the first "[".
function wikiAt(s: string, i: number): Atom | undefined {
	const close = s.indexOf("]]", i + 2);
	if (close < 0) return undefined;
	const inner = s.slice(i + 2, close);
	if (!inner.trim() || inner.includes("[[")) return undefined;
	const bar = inner.indexOf("|");
	// A "\|" (written inside tables) is still the alias bar.
	const target = (bar < 0 ? inner : inner.slice(0, bar)).replace(/\\$/, "").trim();
	const alias = bar < 0 ? "" : inner.slice(bar + 1).trim();
	if (!target) return undefined;
	const label = alias || linkLabel(target);
	return {
		end: close + 2,
		nodes: [{ kind: "internal", target, children: [{ kind: "text", text: label }] }],
	};
}

// How Obsidian shows a link with no alias: "Note > Heading".
function linkLabel(target: string): string {
	const parts = target.split("#").filter((p) => p.length > 0);
	return parts.join(" > ") || target;
}

// [label](destination "title"). The label may hold markup; the destination may
// hold balanced parentheses or be written <in angle brackets>.
function markdownLinkAt(s: string, i: number): Atom | undefined {
	let j = i + 1;
	let depth = 1;
	while (j < s.length) {
		const c = s[j];
		if (c === "\\") {
			j += 2;
			continue;
		}
		if (c === "`") {
			j = codeAt(s, j).end;
			continue;
		}
		if (c === "[") depth++;
		else if (c === "]" && --depth === 0) break;
		j++;
	}
	if (depth !== 0 || s[j + 1] !== "(") return undefined;
	const labelText = s.slice(i + 1, j);

	let k = j + 2;
	let dest: string;
	if (s[k] === "<") {
		const close = s.indexOf(">", k + 1);
		if (close < 0) return undefined;
		dest = s.slice(k + 1, close);
		k = close + 1;
	} else {
		const start = k;
		let parens = 0;
		while (k < s.length) {
			const c = s[k]!;
			if (c === "\\") {
				k += 2;
				continue;
			}
			if (SPACE.test(c)) break;
			if (c === "(") parens++;
			else if (c === ")") {
				if (parens === 0) break;
				parens--;
			}
			k++;
		}
		dest = s.slice(start, k);
	}
	while (SPACE.test(s[k] ?? "")) k++;
	// An optional "title", which isn't shown.
	const quote = s[k];
	if (quote === '"' || quote === "'") {
		const close = s.indexOf(quote, k + 1);
		if (close < 0) return undefined;
		k = close + 1;
		while (SPACE.test(s[k] ?? "")) k++;
	}
	if (s[k] !== ")" || !dest) return undefined;

	const children = labelText.trim() ? parse(labelText) : [{ kind: "text" as const, text: dest }];
	return { end: k + 1, nodes: linkNodes(dest, children) };
}

// A destination with a scheme is a web (or mailto/obsidian) link; one without
// is a note, as Obsidian reads [text](Note.md).
function linkNodes(dest: string, children: Inline[]): Inline[] {
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(dest);
	if (scheme) {
		return SAFE_SCHEMES.has(scheme[1]!.toLowerCase())
			? [{ kind: "external", url: dest, children }]
			: children;
	}
	let target = dest;
	try {
		target = decodeURI(dest);
	} catch {
		// A stray "%" isn't an escape; keep it as written.
	}
	target = target.replace(/\.md(?=#|$)/i, "");
	return [{ kind: "internal", target, children }];
}

// A bare https:// URL, minus trailing punctuation and unbalanced ")" (as in
// "(see https://example.com)").
function urlAt(s: string, i: number): Atom | undefined {
	const prev = s[i - 1];
	if (prev !== undefined && WORD.test(prev)) return undefined;
	const m = BARE_URL.exec(s.slice(i));
	if (!m) return undefined;
	let url = m[0];
	for (;;) {
		const last = url[url.length - 1]!;
		if (".,;:!?'\"*_~".includes(last)) url = url.slice(0, -1);
		else if (last === ")" && count(url, "(") < count(url, ")")) url = url.slice(0, -1);
		else break;
	}
	if (!/^https?:\/\/./i.test(url)) return undefined;
	return {
		end: i + url.length,
		nodes: [{ kind: "external", url, children: [{ kind: "text", text: url }] }],
	};
}

function count(s: string, c: string): number {
	let n = 0;
	for (const ch of s) if (ch === c) n++;
	return n;
}

// #tag, at the start or after a space. "#1" and "# x" stay text.
function tagAt(s: string, i: number): Atom | undefined {
	const prev = s[i - 1];
	if (prev !== undefined && !SPACE.test(prev)) return undefined;
	const m = TAG.exec(s.slice(i));
	if (!m || /^\d+$/.test(m[1]!)) return undefined;
	return { end: i + m[0].length, nodes: [{ kind: "tag", tag: m[1]! }] };
}

// ─── emphasis ──────────────────────────────────────────────────

// *em*, **strong**, ***both***, _em_, __strong__, ~~del~~, ==mark==. An
// opener must be followed by a non-space, a closer preceded by one; "_" only
// counts at a word's edge, so snake_case stays text. A run that opens nothing
// is text, read whole.
function emphasisAt(s: string, i: number): Atom | undefined {
	const c = s[i]!;
	if (c !== "*" && c !== "_" && c !== "~" && c !== "=") return undefined;
	const run = runLength(s, i, c);
	const whole = literal(s.slice(i, i + run), i + run);
	const paired = c === "~" || c === "=";
	if (paired ? run !== 2 : run > 3) return whole;
	const next = s[i + run];
	if (next === undefined || SPACE.test(next)) return whole;
	const prev = s[i - 1];
	if (c === "_" && prev !== undefined && WORD.test(prev)) return whole;

	for (let len = run; len >= (paired ? 2 : 1); len--) {
		const close = findCloser(s, i + run, c, len);
		if (close < 0) continue;
		const content = parse(s.slice(i + run, close));
		const node = wrap(c, len, content);
		const lead = s.slice(i, i + run - len);
		return {
			end: close + len,
			nodes: lead ? [{ kind: "text", text: lead }, node] : [node],
		};
	}
	return whole;
}

function wrap(c: string, len: number, children: Inline[]): Inline {
	if (c === "~") return { kind: "del", children };
	if (c === "=") return { kind: "mark", children };
	if (len === 3) return { kind: "em", children: [{ kind: "strong", children }] };
	return { kind: len === 2 ? "strong" : "em", children };
}

// Where a run of `len` `c`s closes emphasis opened before `from`, or -1. A run
// of exactly `len` wins; failing that, a longer run closes with its last
// `len` characters ("**bold *it***").
function findCloser(s: string, from: number, c: string, len: number): number {
	let longer = -1;
	let j = from;
	while (j < s.length) {
		const atom = atomAt(s, j);
		if (atom) {
			j = atom.end;
			continue;
		}
		if (s[j] !== c) {
			j++;
			continue;
		}
		const r = runLength(s, j, c);
		const before = s[j - 1]!;
		const after = s[j + r];
		const canClose =
			j > from &&
			!SPACE.test(before) &&
			(c !== "_" || after === undefined || !WORD.test(after));
		if (canClose && r === len) return j;
		if (canClose && r > len && longer < 0) longer = j + r - len;
		j += r;
	}
	return longer;
}
