// "Save this day as routines" — turning a day's blocks into routines (decisions 120, 134).
//
// The inverse of applying routines: a day the user (or an AI) planned well
// becomes the routines that would produce it. Only timed blocks are offered,
// each with the tasks in it; the day's Unscheduled list isn't, since a task
// with no block is usually a one-off (Repeat… still covers it). Each block
// repeats on its own rule, and its tasks follow it.
//
// A day usually already has routines in it, so every block is read against the
// whole routines file first, never just the routines due that day, so nothing
// is written twice or overwritten without asking:
//   • a block a routine due that day accounts for (apply.ts's matching) is that
//     routine: not offered again. If the day has it at another time, the row
//     offers moving the routine there instead, unchecked;
//   • a block with the title and time of a routine that isn't due that day
//     (Gym on Mon, Wed; today is Tue) extends that routine's rule rather than
//     adding a second line;
//   • a block that sits where a routine due that day should be, and isn't
//     (Gym renamed "Gym – legs" today), is added, with the choice of replacing
//     that routine instead;
//   • tasks the same way: a copy of a routine due that day is that routine; a
//     copy of one that isn't due adds this day's rule to it.
//
// `saveDayItems` reads the day; `defaultPick` is what the dialog starts with;
// `saveDayPlan` turns the pick into updates and additions, and
// `applySaveDayPlan` writes them to the file text. Pure and vault-free.

import type { Block, ISODate, Task, TimeRange } from "../types";
import { claimBlocks, compatibleAssoc, effectiveAssoc, isCopyOf, routinesFor } from "./apply";
import { blockRepeatDraft, repeatDraft } from "./repeat";
import { parseRoutines, type BlockRoutine, type Routine, type TaskRoutine } from "./routinesFile";
import { RoutinesConflict, addRoutine, draftOf, updateRoutine, type RoutineDraft } from "./routinesWriter";
import { occursOn, ruleKey, type Rule } from "./rules";

export interface SaveDayTask {
	task: Task;
	/** A task routine due that day already makes this task. */
	saved: boolean;
	/** A task routine not due that day that this task is a copy of: saving adds days to it. */
	extends?: TaskRoutine;
}

export interface SaveDayBlock {
	block: Block;
	time: TimeRange;
	/** The routine due that day that accounts for this block. */
	routine?: BlockRoutine;
	/** That routine is at another time than the block: the row offers moving it. */
	moved: boolean;
	/** A routine with this title and time that isn't due that day: saving adds days to it. */
	extends?: BlockRoutine;
	/** A routine due that day, missing from it, whose time this block takes: it can be replaced. */
	replaces?: BlockRoutine;
	/** Other routines with this title, at other times. Shown, not changed. */
	alsoAt: BlockRoutine[];
	tasks: SaveDayTask[];
}

/** The day's timed blocks by start time, each with its tasks, read against the routines file. */
export function saveDayItems(blocks: Block[], routines: Routine[], date: ISODate): SaveDayBlock[] {
	const due = routinesFor(routines, date);
	const claims = claimBlocks(blocks, due);
	const claimedBy = new Map([...claims].map(([r, b]) => [b, r]));
	const blockRoutines = routines.filter((r): r is BlockRoutine => r.kind === "block");
	const taskRoutines = routines.filter((r): r is TaskRoutine => r.kind === "task");
	const dueTasks = taskRoutines.filter((r) => occursOn(r.rule, date));
	// Due routines the day doesn't have: a new block at their time may replace one.
	const missing = blockRoutines.filter((r) => occursOn(r.rule, date) && !claims.has(r));
	const replaced = new Set<BlockRoutine>();

	return blocks
		.filter((b): b is Block & { time: TimeRange } => b.time !== undefined)
		.sort((a, b) => a.time.start - b.time.start || a.time.end - b.time.end)
		.map((block) => {
			const routine = claimedBy.get(block);
			const sameTitle = blockRoutines.filter((r) => r.title === block.title && r !== routine);
			const extend = routine
				? undefined
				: sameTitle.find((r) => r.rule.kind === "weekly" && !occursOn(r.rule, date) && sameTime(r.time, block.time));
			const replaces = routine || extend
				? undefined
				: missing.find((r) => !replaced.has(r) && r.title !== block.title && overlap(r.time, block.time));
			if (replaces) replaced.add(replaces);
			return {
				block,
				time: block.time,
				...(routine ? { routine } : {}),
				moved: routine !== undefined && !sameTime(routine.time, block.time),
				...(extend ? { extends: extend } : {}),
				...(replaces ? { replaces } : {}),
				alsoAt: sameTitle.filter((r) => r !== extend),
				tasks: block.tasks.map((task) => {
					const saved = dueTasks.some((r) => isCopyOf(task, block, r));
					const ext = saved
						? undefined
						: taskRoutines.find(
								(r) => r.rule.kind === "weekly" && !occursOn(r.rule, date) && isCopyOf(task, block, r),
							);
					return { task, saved, ...(ext ? { extends: ext } : {}) };
				}),
			};
		});
}

/** A block row the user can't change: a routine due that day already has it, at its time. */
export function isLocked(item: SaveDayBlock): boolean {
	return item.routine !== undefined;
}

/** What the user picked. */
export interface SaveDayPick {
	/** Checked block rows: added, extended, replaced, or (for a moved routine) moved. */
	blocks: Set<Block>;
	/** Checked tasks. */
	tasks: Set<Task>;
	/** Each block's rule, which its tasks follow. A routine's own rule when it is one. */
	rules: Map<Block, Rule>;
	/** Rows saving over the routine in `replaces` instead of adding. */
	replace: Set<Block>;
}

/**
 * What the dialog starts with: everything new checked, on `rule` (or, for a
 * routine extended, its rule plus `rule`'s days); moving a routine unchecked,
 * since a block is often moved on one day on purpose (decision 61); replacing
 * off, since a renamed block is often a one-off.
 */
export function defaultPick(items: SaveDayBlock[], rule: Rule): SaveDayPick {
	const pick: SaveDayPick = { blocks: new Set(), tasks: new Set(), rules: new Map(), replace: new Set() };
	for (const item of items) {
		pick.rules.set(item.block, item.routine?.rule ?? (item.extends ? withDays(item.extends.rule, rule) : rule));
		if (!item.routine) pick.blocks.add(item.block);
		for (const t of item.tasks) if (!t.saved) pick.tasks.add(t.task);
	}
	return pick;
}

/**
 * Set every row that can change to `rule`, as "Repeat all" does. A row saving
 * onto an existing routine only gains `rule`'s days, so it never loses the ones
 * it had; a routine due that day keeps its own rule.
 */
export function repeatAll(items: SaveDayBlock[], pick: SaveDayPick, rule: Rule): Map<Block, Rule> {
	const rules = new Map(pick.rules);
	for (const item of items) {
		if (item.routine) continue;
		const onto = item.extends ?? (pick.replace.has(item.block) ? item.replaces : undefined);
		rules.set(item.block, onto ? withDays(onto.rule, rule) : rule);
	}
	return rules;
}

/** The rule a block row (and so its tasks) is saved on. */
export function ruleOf(item: SaveDayBlock, pick: SaveDayPick): Rule {
	return item.routine?.rule ?? pick.rules.get(item.block) ?? { kind: "weekly", days: [] };
}

/**
 * `rule` with `more`'s days added, when both are weekly. A monthly rule can't
 * take weekdays, so it stays as it is.
 */
export function withDays(rule: Rule, more: Rule): Rule {
	if (rule.kind !== "weekly" || more.kind !== "weekly") return rule;
	return { kind: "weekly", days: [...new Set([...rule.days, ...more.days])].sort((a, b) => a - b) };
}

/** A routine block that would share time with this row on some of the days its rule covers. */
export interface SaveDayOverlap {
	routine: BlockRoutine;
	days: number[];
}

/**
 * The routine blocks this row would overlap on the days `rule` covers, leaving
 * out the routine the row is (or saves onto). Weekly rules only.
 */
export function overlapsOf(
	item: SaveDayBlock,
	rule: Rule,
	routines: Routine[],
	replacing: boolean,
): SaveDayOverlap[] {
	if (rule.kind !== "weekly") return [];
	const own = new Set([item.routine, item.extends, replacing ? item.replaces : undefined]);
	return routines.flatMap((r) => {
		if (r.kind !== "block" || own.has(r) || r.rule.kind !== "weekly") return [];
		if (!overlap(r.time, item.time)) return [];
		const days = rule.days.filter((d) => r.rule.kind === "weekly" && r.rule.days.includes(d));
		return days.length > 0 ? [{ routine: r, days }] : [];
	});
}

// ─── the plan ──────────────────────────────────────────────────

/** A routine to rewrite, found again by what it is when the plan is written. */
export interface SaveDayUpdate {
	routine: Routine;
	draft: RoutineDraft;
}

/** A task routine to add days to; only the days it doesn't already have. */
export interface SaveDayExtendTask {
	routine: TaskRoutine;
	days: Rule;
}

export interface SaveDayPlan {
	updates: SaveDayUpdate[];
	extendTasks: SaveDayExtendTask[];
	adds: RoutineDraft[];
}

/** How many routines a plan adds and how many it changes, for the button and the notice. */
export function planCounts(plan: SaveDayPlan): { added: number; updated: number } {
	return { added: plan.adds.length, updated: plan.updates.length + plan.extendTasks.length };
}

/** The edits the pick makes: block routines changed, task routines extended, routines added. */
export function saveDayPlan(items: SaveDayBlock[], pick: SaveDayPick): SaveDayPlan {
	const plan: SaveDayPlan = { updates: [], extendTasks: [], adds: [] };
	const addedTasks: RoutineDraft[] = [];
	for (const item of items) {
		const rule = ruleOf(item, pick);
		const checked = pick.blocks.has(item.block);
		if (item.routine) {
			if (item.moved && checked) {
				plan.updates.push({ routine: item.routine, draft: { ...draftOf(item.routine), time: item.time } as RoutineDraft });
			}
		} else if (checked && item.extends) {
			if (ruleKey(rule) !== ruleKey(item.extends.rule)) {
				plan.updates.push({ routine: item.extends, draft: { ...draftOf(item.extends), rule } });
			}
		} else if (checked && item.replaces && pick.replace.has(item.block)) {
			plan.updates.push({ routine: item.replaces, draft: blockRepeatDraft(item.block, item.time, rule) });
		} else if (checked) {
			plan.adds.push(blockRepeatDraft(item.block, item.time, rule));
		}
		for (const t of item.tasks) {
			if (t.saved || !pick.tasks.has(t.task)) continue;
			if (t.extends) plan.extendTasks.push({ routine: t.extends, days: rule });
			else addedTasks.push(repeatDraft(t.task, item.block, rule));
		}
	}
	plan.adds.push(...addedTasks);
	return plan;
}

/**
 * Write `plan` into the routines file text: block routines first (a block that
 * changes rule takes its nested tasks with it), then task routines extended,
 * then additions, blocks before tasks so each task nests under its block. Each
 * routine is found again by what it is, since the edits before it move lines;
 * one that is gone throws `RoutinesConflict`.
 */
export function applySaveDayPlan(markdown: string, plan: SaveDayPlan): string {
	let md = markdown;
	for (const u of plan.updates) {
		const now = parseRoutines(md).routines.find((r) => sameRoutine(r, u.routine));
		if (!now) throw new RoutinesConflict();
		md = updateRoutine(md, now, u.draft);
	}
	for (const e of plan.extendTasks) {
		const now = findTask(md, e.routine);
		if (!now) throw new RoutinesConflict();
		const rule = withDays(now.rule, e.days);
		// Its block may have brought it along already.
		if (ruleKey(rule) === ruleKey(now.rule)) continue;
		md = updateRoutine(md, now, { ...draftOf(now), rule });
	}
	return plan.adds.reduce(addRoutine, md);
}

function sameRoutine(a: Routine, b: Routine): boolean {
	if (ruleKey(a.rule) !== ruleKey(b.rule)) return false;
	if (a.kind === "block" && b.kind === "block") return a.title === b.title && sameTime(a.time, b.time);
	if (a.kind === "task" && b.kind === "task") return a.text === b.text && a.home === b.home;
	return false;
}

/** A task routine by text, home and association, preferring one still on its old rule. */
function findTask(md: string, r: TaskRoutine): TaskRoutine | undefined {
	const same = parseRoutines(md).routines.filter(
		(x): x is TaskRoutine =>
			x.kind === "task" && x.text === r.text && x.home === r.home && compatibleAssoc(effectiveAssoc(x), effectiveAssoc(r)),
	);
	return same.find((x) => ruleKey(x.rule) === ruleKey(r.rule)) ?? same[0];
}

function sameTime(a: TimeRange, b: TimeRange): boolean {
	return a.start === b.start && a.end === b.end;
}

/** Sharing some time; touching end to start doesn't count (as routinesWeek.ts). */
function overlap(a: TimeRange, b: TimeRange): boolean {
	return a.start < b.end && b.start < a.end;
}
