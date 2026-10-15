// Routines file writer — surgical edits to `Routines.md`.
//
// Unlike the backlog, which Kairos owns and rewrites whole, the routines file is
// something people write by hand: prose, notes, headings that aren't rules, odd
// spacing. So every edit here touches only the lines it must and leaves every
// other line byte-identical:
//
//   • update — a routine's own line is re-rendered in place (its indentation
//     and any `🔁` override kept). Changing a routine's rule, or a task's home
//     block, moves it instead: off its line and in under the right heading.
//     A block moves with the tasks nested under it.
//   • remove — a routine's line goes; a block takes its nested tasks with it,
//     and a home line left with nothing under it goes too (it made nothing).
//   • add — appended to the end of the first section whose heading is the same
//     rule (by `ruleKey`, so "Mon, Wed" finds "## Monday and Wednesday"). With no
//     such section, a new `## <rule>` heading is added at the end of the file.
//     A homed task nests under that section's block or home line of the same
//     title, or under a new home line.
//
// Edits address a routine by the line it was parsed from. Before writing, the
// line is checked to still be that routine; if the file changed underneath
// (edited by hand, synced), `RoutinesConflict` is thrown rather than editing the
// wrong line. Pure and vault-free.

import type { Association, Block, Task, TimeRange } from "../types";
import { serializeBlock, serializeTask } from "../serializer";
import { stripMetadata } from "../parser";
import {
	HEADING,
	LIST_ITEM,
	REPEAT,
	indentWidth,
	parseRoutines,
	skipFrontmatter,
	type Routine,
	type TaskRoutine,
} from "./routinesFile";
import { parseRule, ruleKey, ruleText, type Rule } from "./rules";

/** A routine as the writer takes it: everything but where it lives. */
export type RoutineDraft =
	| {
			kind: "block";
			rule: Rule;
			title: string;
			time: TimeRange;
			assoc?: Association;
			metadata?: string;
	  }
	| {
			kind: "task";
			rule: Rule;
			text: string;
			/** Written on the task line itself. */
			assoc?: Association;
			metadata?: string;
			/** The block it belongs in; absent → the day's Unscheduled list. */
			home?: string;
			/** Written on a home line this edit has to create (inherited by the task). */
			homeAssoc?: Association;
	  };

/** The file changed since it was parsed: the routine isn't on its line any more. */
export class RoutinesConflict extends Error {
	constructor() {
		super("Routines file changed since it was read");
		this.name = "RoutinesConflict";
	}
}

/** The draft that reproduces a parsed routine. */
export function draftOf(r: Routine): RoutineDraft {
	if (r.kind === "block") {
		return {
			kind: "block",
			rule: r.rule,
			title: r.title,
			time: r.time,
			...(r.assoc ? { assoc: r.assoc } : {}),
			...(r.metadata ? { metadata: r.metadata } : {}),
		};
	}
	return {
		kind: "task",
		rule: r.rule,
		text: r.text,
		...(r.assoc ? { assoc: r.assoc } : {}),
		...(r.metadata ? { metadata: r.metadata } : {}),
		...(r.home !== undefined ? { home: r.home } : {}),
		...(r.inherited ? { homeAssoc: r.inherited } : {}),
	};
}

// ─── public API ────────────────────────────────────────────────

export function addRoutine(markdown: string, draft: RoutineDraft): string {
	const doc = open(markdown);
	insertDraft(doc, draft);
	return close(doc);
}

/**
 * Give a task routine a block of its own: add a block routine on the task's
 * rule and move the task into it, in one edit. The task keeps the association
 * it showed (its own, or the one it inherited from its old home).
 */
export function scheduleInNewBlock(
	markdown: string,
	task: TaskRoutine,
	title: string,
	time: TimeRange,
): string {
	locate(markdown, task);
	const withBlock = addRoutine(markdown, { kind: "block", rule: task.rule, title, time });
	const moved = parseRoutines(withBlock).routines.find(
		(r): r is TaskRoutine =>
			r.kind === "task" &&
			r.text === task.text &&
			r.home === task.home &&
			ruleKey(r.rule) === ruleKey(task.rule),
	);
	if (!moved) return withBlock;
	const { home: _home, homeAssoc: _homeAssoc, ...rest } = draftOf(moved) as Extract<RoutineDraft, { kind: "task" }>;
	const assoc = moved.assoc ?? moved.inherited;
	return updateRoutine(withBlock, moved, { ...rest, ...(assoc ? { assoc } : {}), home: title });
}

export function removeRoutine(markdown: string, routine: Routine): string {
	const doc = open(markdown);
	locate(markdown, routine);
	removeAt(doc, routine);
	return close(doc);
}

export function updateRoutine(
	markdown: string,
	routine: Routine,
	draft: RoutineDraft,
): string {
	const doc = open(markdown);
	locate(markdown, routine);
	const i = routine.line;
	const sameRule = ruleKey(routine.rule) === ruleKey(draft.rule);

	if (draft.kind !== routine.kind) {
		removeAt(doc, routine);
		insertDraft(doc, draft);
		return close(doc);
	}

	if (draft.kind === "block") {
		if (sameRule) {
			doc.lines[i] = rerender(doc.lines[i] ?? "", draft);
			return close(doc);
		}
		// Move the block with everything nested under it.
		const [from, to] = extent(doc.lines, i);
		const moved = doc.lines.slice(from, to);
		moved[0] = renderLine(draft);
		doc.lines.splice(from, to - from);
		pruneEmptySection(doc, from);
		insertLines(doc, draft.rule, moved);
		return close(doc);
	}

	const sameHome = (routine.kind === "task" ? routine.home ?? "" : "") === (draft.home ?? "");
	if (sameRule && sameHome) {
		doc.lines[i] = rerender(doc.lines[i] ?? "", draft);
		return close(doc);
	}
	removeAt(doc, routine);
	insertDraft(doc, draft);
	return close(doc);
}

// ─── document ──────────────────────────────────────────────────

interface Doc {
	lines: string[];
	eol: string;
}

function open(markdown: string): Doc {
	const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
	return { lines: markdown === "" ? [] : markdown.split(/\r?\n/), eol };
}

function close(doc: Doc): string {
	if (doc.lines.length > 0 && doc.lines[doc.lines.length - 1] !== "") doc.lines.push("");
	return doc.lines.join(doc.eol);
}

interface Section {
	rule?: Rule;
	/** Content lines are [start, end). */
	start: number;
	end: number;
}

function sections(lines: string[]): Section[] {
	const out: Section[] = [];
	let cur: Section = { start: skipFrontmatter(lines), end: lines.length };
	for (let i = cur.start; i < lines.length; i++) {
		const h = HEADING.exec(lines[i] ?? "");
		if (!h) continue;
		cur.end = i;
		out.push(cur);
		const rule = parseRule(h[1] ?? "");
		cur = { ...(rule ? { rule } : {}), start: i + 1, end: lines.length };
	}
	out.push(cur);
	return out;
}

function leadingWidth(line: string): number {
	return indentWidth(/^[ \t]*/.exec(line)?.[0] ?? "");
}

/** Line `i` and every following line nested deeper than it, as [from, to). */
function extent(lines: string[], i: number): [number, number] {
	const base = leadingWidth(lines[i] ?? "");
	let j = i + 1;
	while (j < lines.length) {
		const line = lines[j] ?? "";
		if (HEADING.test(line)) break;
		if (line.trim() !== "" && leadingWidth(line) <= base) break;
		j++;
	}
	while (j - 1 > i && (lines[j - 1] ?? "").trim() === "") j--;
	return [i, j];
}

/** Throw unless `routine` is still what its line parses to. */
function locate(markdown: string, routine: Routine): void {
	const found = parseRoutines(markdown).routines.find((r) => r.line === routine.line);
	if (!found || !sameIdentity(found, routine)) throw new RoutinesConflict();
}

function sameIdentity(a: Routine, b: Routine): boolean {
	if (a.kind === "block" && b.kind === "block") {
		return a.title === b.title && a.time.start === b.time.start && a.time.end === b.time.end;
	}
	if (a.kind === "task" && b.kind === "task") return a.text === b.text;
	return false;
}

// ─── rendering ─────────────────────────────────────────────────

const DRAFT_SOURCE = { path: "", line: 0 };

/** A routine's line at the top level of a section (`- …`, no indent, no 🔁). */
function renderLine(draft: RoutineDraft): string {
	if (draft.kind === "block") {
		const block: Block = {
			source: DRAFT_SOURCE,
			title: draft.title,
			time: draft.time,
			tasks: [],
			scheduled: true,
			...(draft.assoc ? { assoc: draft.assoc } : {}),
			...(draft.metadata ? { metadata: draft.metadata } : {}),
		};
		return serializeBlock(block)[0] ?? "";
	}
	const task: Task = {
		source: DRAFT_SOURCE,
		text: draft.text,
		status: " ",
		...(draft.assoc ? { assoc: draft.assoc } : {}),
		...(draft.metadata ? { metadata: draft.metadata } : {}),
	};
	return "- " + serializeTask(task);
}

function renderHome(title: string, assoc: Association | undefined): string {
	return (
		serializeBlock({
			source: DRAFT_SOURCE,
			title,
			tasks: [],
			scheduled: false,
			...(assoc ? { assoc } : {}),
		})[0] ?? ""
	);
}

/**
 * Re-render a line in place: same leading whitespace, and a `🔁` override kept
 * (canonically spelled) when the line had one.
 */
function rerender(line: string, draft: RoutineDraft): string {
	const ws = /^[ \t]*/.exec(line)?.[0] ?? "";
	const override = REPEAT.test(line) ? ` 🔁 ${ruleText(draft.rule)}` : "";
	return ws + renderLine(draft) + override;
}

// ─── removing ──────────────────────────────────────────────────

function removeAt(doc: Doc, routine: Routine): void {
	const i = routine.line;
	if (routine.kind === "block") {
		const [from, to] = extent(doc.lines, i);
		doc.lines.splice(from, to - from);
		pruneEmptySection(doc, from);
		return;
	}
	const parent = routine.home !== undefined ? parentLine(doc.lines, i) : undefined;
	doc.lines.splice(i, 1);
	if (parent !== undefined && isHomeLine(doc.lines[parent] ?? "")) {
		const [from, to] = extent(doc.lines, parent);
		if (to - from === 1) doc.lines.splice(parent, 1);
	}
	pruneEmptySection(doc, Math.min(i, parent ?? i));
}

/**
 * Drop the rule heading above line `i` once its section holds nothing but
 * blank lines — removing or moving its last routine shouldn't leave an empty
 * "## Weekdays" behind. A heading that isn't a rule, or a section that still
 * has any text (prose included), is left alone.
 */
function pruneEmptySection(doc: Doc, i: number): void {
	let h = Math.min(i, doc.lines.length) - 1;
	while (h >= 0 && !HEADING.test(doc.lines[h] ?? "")) h--;
	if (h < 0) return;
	const heading = HEADING.exec(doc.lines[h] ?? "");
	if (!heading || !parseRule(heading[1] ?? "")) return;
	let end = h + 1;
	while (end < doc.lines.length && !HEADING.test(doc.lines[end] ?? "")) {
		if ((doc.lines[end] ?? "").trim() !== "") return;
		end++;
	}
	doc.lines.splice(h, end - h);
	// Don't leave a doubled blank line (or a blank one at the very end) behind.
	const blank = (k: number) => k < doc.lines.length && (doc.lines[k] ?? "").trim() === "";
	if (h > 0 && blank(h - 1) && (h >= doc.lines.length || blank(h))) doc.lines.splice(h - 1, 1);
}

/** The nearest line above `i` that is a list item indented less than it. */
function parentLine(lines: string[], i: number): number | undefined {
	const width = leadingWidth(lines[i] ?? "");
	for (let j = i - 1; j >= 0; j--) {
		const line = lines[j] ?? "";
		if (HEADING.test(line)) return undefined;
		if (LIST_ITEM.test(line) && leadingWidth(line) < width) return j;
	}
	return undefined;
}

/** An untimed list line without a checkbox: names a block, makes nothing. */
function isHomeLine(line: string): boolean {
	const item = LIST_ITEM.exec(line);
	if (!item || item[2] !== undefined) return false;
	return !/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s/.test((item[3] ?? "").trim());
}

// ─── adding ────────────────────────────────────────────────────

function insertDraft(doc: Doc, draft: RoutineDraft): void {
	if (draft.kind === "task" && draft.home !== undefined && draft.home !== "") {
		const section = findSection(doc.lines, draft.rule);
		const host = section ? findHome(doc.lines, section, draft.home, draft.rule) : undefined;
		const line = "\t" + renderLine(draft);
		if (host !== undefined) {
			const [, to] = extent(doc.lines, host);
			doc.lines.splice(to, 0, line);
			return;
		}
		insertLines(doc, draft.rule, [renderHome(draft.home, draft.homeAssoc), line]);
		return;
	}
	insertLines(doc, draft.rule, [renderLine(draft)]);
}

function findSection(lines: string[], rule: Rule): Section | undefined {
	const key = ruleKey(rule);
	return sections(lines).find((s) => s.rule && ruleKey(s.rule) === key);
}

/**
 * A top-level block or home line titled `home` in `section` whose tasks would
 * follow `rule` (no `🔁` of its own, or one naming the same rule).
 */
function findHome(
	lines: string[],
	section: Section,
	home: string,
	rule: Rule,
): number | undefined {
	const parsed = parseRoutines(lines.join("\n"));
	for (let i = section.start; i < section.end; i++) {
		const line = lines[i] ?? "";
		const item = LIST_ITEM.exec(line);
		if (!item || leadingWidth(line) !== 0) continue;
		const own = REPEAT.exec(line);
		if (own && ruleKey(parseRule(own[1] ?? "") ?? rule) !== ruleKey(rule)) continue;
		const block = parsed.routines.find((r) => r.line === i);
		if (block?.kind === "block" && block.title === home) return i;
		if (isHomeLine(line) && homeTitle(line) === home) return i;
	}
	return undefined;
}

function homeTitle(line: string): string {
	const body = (LIST_ITEM.exec(line)?.[3] ?? "").replace(REPEAT, " ").trim();
	return stripMetadata(body).title;
}

/** Append lines at the end of `rule`'s section, creating it if needed. */
function insertLines(doc: Doc, rule: Rule, add: string[]): void {
	const section = findSection(doc.lines, rule);
	if (section) {
		let at = section.end;
		while (at > section.start && (doc.lines[at - 1] ?? "").trim() === "") at--;
		doc.lines.splice(at, 0, ...add);
		return;
	}
	while (doc.lines.length > 0 && doc.lines[doc.lines.length - 1] === "") doc.lines.pop();
	if (doc.lines.length > 0) doc.lines.push("");
	doc.lines.push(`## ${ruleText(rule)}`, ...add);
}
