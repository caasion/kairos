// Routines view model — the pure shape behind the Routines view.
//
// Routines are grouped by WHEN they repeat: one group per rule, ordered Daily,
// Weekdays, Weekends, day lists (by first weekday), then monthly rules (by day
// of month). Two spellings of the same rule ("Mon, Wed" under one heading and
// `🔁 Monday and Wednesday` on a line elsewhere) land in the same group. Within
// a group, routines keep file order, so a block's tasks follow it.
//
// Pure and vault-free (mirrors backlogModel.ts).

import type { Routine } from "./routinesFile";
import { compareRules, ruleKey, ruleText, type Rule } from "./rules";

export interface RoutineGroup {
	/** Stable key for keyed rendering: the rule's `ruleKey`. */
	key: string;
	rule: Rule;
	/** Canonical rule text: "Daily", "Mon, Wed", "Monthly on 1". */
	name: string;
	routines: Routine[];
}

export function groupRoutines(routines: Routine[]): RoutineGroup[] {
	const groups = new Map<string, RoutineGroup>();
	for (const r of routines) {
		const key = ruleKey(r.rule);
		let group = groups.get(key);
		if (!group) {
			group = { key, rule: r.rule, name: ruleText(r.rule), routines: [] };
			groups.set(key, group);
		}
		group.routines.push(r);
	}
	return [...groups.values()]
		.map((g) => ({ ...g, routines: [...g.routines].sort((a, b) => a.line - b.line) }))
		.sort((a, b) => compareRules(a.rule, b.rule));
}

/** A stable identity for a routine row within one parse (its source line). */
export function routineKey(r: Routine): number {
	return r.line;
}
