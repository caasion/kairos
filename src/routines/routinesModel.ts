// Routines view model — the pure shape behind the Routines view.
//
// Routines are grouped by WHEN they repeat: one group per rule, ordered Daily,
// Weekdays, Weekends, day lists (by first weekday), then monthly rules (by day
// of month). Two spellings of the same rule ("Mon, Wed" under one heading and
// `🔁 Monday and Wednesday` on a line elsewhere) land in the same group. Within
// a group, routines keep file order, so a block's tasks follow it.
//
// Pure and vault-free (mirrors backlogModel.ts).

import type { BlockRoutine, Routine, TaskRoutine } from "./routinesFile";
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

/**
 * One block's slice of a rule group, laid out the way the Grid groups a cell's
 * tasks (decision 70): a header for the block, its tasks under it. That's how
 * the list shows which block a task belongs to, and where "+" adds one.
 */
export interface RoutineBlockGroup {
	key: string;
	/** A timed block routine heading the group (a checkable one is its own row). */
	block?: BlockRoutine;
	/** An untimed home with no block routine of its own here ("Night routine"). */
	home?: string;
	/** Neither: the day's Unscheduled list. Always present, always last. */
	unscheduled?: true;
	tasks: TaskRoutine[];
}

/**
 * A rule group's routines as block groups: timed blocks by start time, each
 * with the tasks homed in it; then homes with no timed block in this group;
 * then Unscheduled, shown even when empty so there's always a place to add a
 * task with no block (the Grid always shows its Unscheduled header too).
 */
export function blockGroupsOf(routines: Routine[]): RoutineBlockGroup[] {
	const blocks = routines
		.filter((r): r is BlockRoutine => r.kind === "block")
		.sort((a, b) => a.time.start - b.time.start || a.time.end - b.time.end || a.line - b.line);
	const tasks = routines.filter((r): r is TaskRoutine => r.kind === "task");
	const claimed = new Set<TaskRoutine>();

	const out: RoutineBlockGroup[] = blocks.map((block) => {
		const own = tasks.filter((t) => !claimed.has(t) && t.home === block.title);
		for (const t of own) claimed.add(t);
		return { key: `block:${block.line}`, block, tasks: own };
	});

	const homes = new Map<string, TaskRoutine[]>();
	const loose: TaskRoutine[] = [];
	for (const t of tasks) {
		if (claimed.has(t)) continue;
		if (!t.home) {
			loose.push(t);
			continue;
		}
		const list = homes.get(t.home);
		if (list) list.push(t);
		else homes.set(t.home, [t]);
	}
	for (const [home, list] of homes) out.push({ key: `home:${home}`, home, tasks: list });
	out.push({ key: "unscheduled", unscheduled: true, tasks: loose });
	return out;
}

/** A stable identity for a routine row within one parse (its source line). */
export function routineKey(r: Routine): number {
	return r.line;
}
