// Kairos backlog file parsing / serialization.
//
// The backlog is a single, global, flat markdown file (spec §2.6): a scratchpad
// of intentions the user hasn't scheduled yet. Every entry is one list item:
//
//   - text [Assoc] 📅 YYYY-MM-DD
//
// where both trailing tokens are optional:
//   • [Assoc]  — the same association syntax used everywhere else: `[Project]`
//                or `[D:Domain]`. Absent ⇒ the entry is Unassociated (a
//                first-class state, spec §2.3), not an error.
//   • 📅 date  — a resurface (snooze) date marking when the entry should surface
//                in the planner. The obsidian-tasks "due" emoji is reused so the
//                line reads correctly in any editor and never collides with the
//                freeform `(paren)` metadata used on tasks.
//
// Entries are NOT tasks: they carry no checkbox and cannot be checked off. A
// leading `[ ]`/`[x]` checkbox, if the user types one, is tolerated on read and
// dropped on write — the backlog owns intentions, the daily note owns tasks.
//
// Pure and vault-free (mirrors parser.ts / serializer.ts): takes file text +
// path, returns `BacklogEntry[]`; and the inverse. The round-trip invariant is
//
//   parseBacklog(serializeBacklog(entries), path)  ≡  entries
//
// comparing structure only (SourceRef.line is re-derived by the parser).

import type { Association, BacklogEntry, ISODate, SourceRef } from "./types";
import { parseAssociation } from "./parser";

// ─── grammar ───────────────────────────────────────────────────

// A flat list item: leading marker, an optional (ignored) checkbox, the rest.
//   group 1: checkbox status char, if present (tolerated, then discarded)
//   group 2: the entry body (text + trailing metadata)
const LIST_ITEM = /^[ \t]*[-*+]\s+(?:\[.\]\s+)?(.*)$/;

// Trailing "[...]" association tag.
const TRAILING_ASSOC = /\s*\[([^\]]+)\]\s*$/;

// Trailing resurface date: the tasks "due" emoji then an ISO date.
const RESURFACE = /\s*📅\s*(\d{4}-\d{2}-\d{2})\s*$/;

// ─── parse ─────────────────────────────────────────────────────

/**
 * Parse a backlog file into its entries, in document order. Any non-list line
 * (frontmatter, prose, headings, blanks) is skipped, so a user can keep notes
 * around the list without breaking it. An empty or missing file yields `[]`.
 *
 * @param markdown  full file text
 * @param path      the backlog file's path, recorded in every SourceRef
 */
export function parseBacklog(markdown: string, path: string): BacklogEntry[] {
	const lines = markdown.split(/\r?\n/);
	const entries: BacklogEntry[] = [];

	for (let i = 0; i < lines.length; i++) {
		const item = LIST_ITEM.exec(lines[i] ?? "");
		if (!item) continue;

		const source: SourceRef = { path, line: i };
		entries.push(parseEntry(item[1] ?? "", source));
	}

	return entries;
}

/**
 * Parse one entry body (the text after the list marker) into a `BacklogEntry`.
 * Peels trailing tokens right-to-left — resurface date and association, in
 * either order — leaving the remaining text as the entry description.
 */
export function parseEntry(body: string, source: SourceRef): BacklogEntry {
	let text = body.trim();
	let assoc: Association | undefined;
	let resurface: ISODate | undefined;

	for (;;) {
		const r = RESURFACE.exec(text);
		if (r && resurface === undefined) {
			resurface = r[1];
			text = text.slice(0, r.index).trimEnd();
			continue;
		}
		const a = TRAILING_ASSOC.exec(text);
		if (a && assoc === undefined) {
			const parsed = parseAssociation(a[1] ?? "");
			if (parsed) {
				assoc = parsed;
				text = text.slice(0, a.index).trimEnd();
				continue;
			}
		}
		break;
	}

	return {
		source,
		text,
		...(assoc ? { assoc } : {}),
		...(resurface ? { resurface } : {}),
	};
}

// ─── serialize ─────────────────────────────────────────────────

/**
 * Serialize entries back into a backlog file body: one list item per entry, in
 * order, ending with a trailing newline. The whole file is the list — there is
 * no heading or frontmatter to preserve, so (unlike the daily note) this owns
 * the entire file text.
 */
export function serializeBacklog(entries: BacklogEntry[]): string {
	if (entries.length === 0) return "";
	return entries.map((e) => "- " + serializeEntry(e)).join("\n") + "\n";
}

/** Render one entry's body (the part after "- "): text, association, date. */
export function serializeEntry(entry: BacklogEntry): string {
	let out = entry.text;
	if (entry.assoc) out += ` [${formatAssoc(entry.assoc)}]`;
	if (entry.resurface) out += ` 📅 ${entry.resurface}`;
	return out;
}

/** `[Project]` → `Project`; `[D:Domain]` → `D:Domain`. */
function formatAssoc(assoc: Association): string {
	return assoc.kind === "domain" ? `D:${assoc.id}` : assoc.id;
}
