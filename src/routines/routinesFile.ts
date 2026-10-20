// Routines file parser — `Routines.md` into a flat list of routines.
//
// The file uses the daily note's Schedule grammar, grouped under headings that
// name a rule. A heading sets the default rule for every line under it; a line
// can override it with a trailing `🔁 <rule>`. A heading that isn't a rule
// ("## Notes") leaves its lines without one, and a line without a rule never
// occurs — it is reported in `problems` so it isn't silently dead.
//
//   ## Weekdays
//   - 07:30 - 08:00 Morning Routine          ← block routine
//   	- [ ] Take meds                        ← task, homed in "Morning Routine"
//   - 18:00 - 19:00 Gym [Fitness] 🔁 Tue, Thu     ← block routine, own rule
//
//   ## Daily
//   - [ ] Water the plants [D:Home]           ← task, lands in Unscheduled
//   - Night Routine                           ← a home: names a block, makes none
//   	- [ ] Journal                          ← task, homed in "Night Routine"
//
// So the line shape decides what a routine makes, with no extra syntax:
//   • a timed top-level line makes a block (a block has no status, so a
//     checkbox on it, left from when blocks could be checked, is ignored);
//   • an untimed top-level line WITH a checkbox makes a task for the day's list;
//   • an untimed top-level line WITHOUT a checkbox is a home — it names a block
//     and makes nothing itself; the tasks under it go into the day's block of
//     that title, or Unscheduled when the day has none;
//   • a task under a timed line is homed in that block the same way.
// A nested task inherits its parent line's rule unless it carries its own 🔁.
//
// Pure and vault-free.

import type { Association, TimeRange } from "../types";
import { parseTime, stripMetadata } from "../parser";
import { parseRule, type Rule } from "./rules";

export interface BlockRoutine {
	kind: "block";
	rule: Rule;
	title: string;
	time: TimeRange;
	assoc?: Association;
	metadata?: string;
	/**
	 * The line still has the checkbox a block could once carry. It changes
	 * nothing the routine makes; it only keeps the routines hash such a line
	 * had (see `canonical` in apply.ts), so days set up from it don't go stale.
	 * Editing the routine rewrites the line without it.
	 */
	legacyCheckbox?: true;
	line: number;
}

export interface TaskRoutine {
	kind: "task";
	rule: Rule;
	text: string;
	/** Explicit association written on the routine line. */
	assoc?: Association;
	/** The home line's association, which the task inherits when it has none. */
	inherited?: Association;
	metadata?: string;
	/** Title of the block it belongs in; absent → the day's Unscheduled list. */
	home?: string;
	line: number;
}

export type Routine = BlockRoutine | TaskRoutine;

export interface RoutineProblem {
	line: number;
	message: string;
}

export interface ParsedRoutines {
	routines: Routine[];
	problems: RoutineProblem[];
}

// Shared with the writer (routinesWriter.ts), which edits the same grammar.
export const LIST_ITEM = /^([ \t]*)[-*+]\s+(?:\[(.)\]\s+)?(.*)$/;
export const HEADING = /^#{1,6}\s+(.*)$/;
// `🔁 rule` up to the next `[` or `(` (an association or note) or the end.
export const REPEAT = /\s*🔁\s*([^[(]*?)\s*(?=[[(]|$)/u;
// A leading "HH:MM - HH:MM", valid or not.
const LOOKS_TIMED = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s/;

interface Parent {
	indent: number;
	rule: Rule | undefined;
	home: string;
	assoc?: Association;
}

export function parseRoutines(markdown: string): ParsedRoutines {
	const lines = markdown.split(/\r?\n/);
	const routines: Routine[] = [];
	const problems: RoutineProblem[] = [];

	let i = skipFrontmatter(lines);
	let headingRule: Rule | undefined;
	let parent: Parent | undefined;

	for (; i < lines.length; i++) {
		const raw = lines[i] ?? "";

		const heading = HEADING.exec(raw);
		if (heading) {
			headingRule = parseRule(heading[1] ?? "");
			parent = undefined;
			continue;
		}

		const item = LIST_ITEM.exec(raw);
		if (!item) continue;

		const indent = indentWidth(item[1] ?? "");
		const checked = item[2] !== undefined;
		const { body, rule: own, badRule } = takeRepeat(item[3] ?? "");
		if (badRule !== undefined) {
			problems.push({ line: i, message: `Unknown repeat rule "${badRule}"` });
		}
		const { title, assoc, metadata } = stripMetadata(body);
		if (!title) continue;

		// A nested line under a top-level line → a task homed in that line's block.
		if (parent && indent > parent.indent) {
			const rule = own ?? parent.rule;
			if (!rule) {
				problems.push({ line: i, message: `"${title}" has no repeat rule` });
				continue;
			}
			routines.push({
				kind: "task",
				rule,
				text: title,
				...(assoc ? { assoc } : {}),
				...(parent.assoc ? { inherited: parent.assoc } : {}),
				...(metadata ? { metadata } : {}),
				home: parent.home,
				line: i,
			});
			continue;
		}

		const rule = own ?? headingRule;
		const time = parseTime(title);

		if (time) {
			parent = { indent, rule, home: time.title, ...(assoc ? { assoc } : {}) };
			if (!rule) {
				problems.push({ line: i, message: `"${time.title}" has no repeat rule` });
				continue;
			}
			routines.push({
				kind: "block",
				rule,
				title: time.title,
				time: time.range,
				...(assoc ? { assoc } : {}),
				...(metadata ? { metadata } : {}),
				...(checked ? { legacyCheckbox: true as const } : {}),
				line: i,
			});
			continue;
		}

		// A time range that doesn't parse ("25:00 - 26:00", "10:00 - 09:00") makes
		// no block; report it rather than let the routine silently vanish. Lines
		// under it stay homed by its text, as under any untimed line.
		if (LOOKS_TIMED.test(title)) {
			parent = { indent, rule, home: title, ...(assoc ? { assoc } : {}) };
			problems.push({ line: i, message: `"${title}" has an invalid time range` });
			continue;
		}

		if (!checked) {
			// A home: names a block for the tasks under it; makes nothing itself.
			parent = { indent, rule, home: title, ...(assoc ? { assoc } : {}) };
			continue;
		}

		// An untimed checkbox line: a task for the day's Unscheduled list.
		parent = undefined;
		if (!rule) {
			problems.push({ line: i, message: `"${title}" has no repeat rule` });
			continue;
		}
		routines.push({
			kind: "task",
			rule,
			text: title,
			...(assoc ? { assoc } : {}),
			...(metadata ? { metadata } : {}),
			line: i,
		});
	}

	return { routines, problems };
}

/** Peel a `🔁 rule` off a line body. */
function takeRepeat(body: string): {
	body: string;
	rule?: Rule;
	badRule?: string;
} {
	const m = REPEAT.exec(body);
	if (!m) return { body };
	const text = (m[1] ?? "").trim();
	const rest = (body.slice(0, m.index) + " " + body.slice(m.index + m[0].length))
		.replace(/\s+/g, " ")
		.trim();
	const rule = parseRule(text);
	return rule ? { body: rest, rule } : { body: rest, badRule: text };
}

export function skipFrontmatter(lines: string[]): number {
	if (lines[0]?.trim() !== "---") return 0;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") return i + 1;
	}
	return 0;
}

export function indentWidth(ws: string): number {
	let width = 0;
	for (const ch of ws) width += ch === "\t" ? 4 : 1;
	return width;
}
