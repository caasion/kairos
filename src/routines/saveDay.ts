// "Save this day as routines" — turning a day's blocks into routines (decision 120).
//
// The inverse of applying routines: a day the user (or an AI) planned well
// becomes the routines that would produce it. Only timed blocks are offered,
// each with the tasks in it; the day's Unscheduled list isn't, since a task
// with no block is usually a one-off (Repeat… still covers it).
//
// What's already a routine is marked, by the same matching applying uses
// (apply.ts): a block a routine due that day accounts for, a task that is a
// copy of a task routine due that day. Saving those again would make a second
// routine that applying then wants a second copy of.
//
// `saveDayItems` lists the candidates; `saveDayDrafts` turns the picked ones
// into routine drafts under one rule, blocks first so a block's tasks nest
// under it. Pure and vault-free.

import type { Block, ISODate, Task, TimeRange } from "../types";
import { claimBlocks, isCopyOf, routinesFor } from "./apply";
import { blockRepeatDraft, repeatDraft } from "./repeat";
import type { Routine } from "./routinesFile";
import type { RoutineDraft } from "./routinesWriter";
import type { Rule } from "./rules";

export interface SaveDayTask {
	task: Task;
	/** A task routine due that day already makes this task. */
	saved: boolean;
}

export interface SaveDayBlock {
	block: Block;
	time: TimeRange;
	/** A block routine due that day already accounts for this block. */
	saved: boolean;
	tasks: SaveDayTask[];
}

/** The day's timed blocks by start time, each with its tasks, marked when already a routine. */
export function saveDayItems(blocks: Block[], routines: Routine[], date: ISODate): SaveDayBlock[] {
	const due = routinesFor(routines, date);
	const claimed = new Set(claimBlocks(blocks, due).values());
	const taskRoutines = due.filter((r) => r.kind === "task");
	return blocks
		.filter((b): b is Block & { time: TimeRange } => b.time !== undefined)
		.sort((a, b) => a.time.start - b.time.start || a.time.end - b.time.end)
		.map((block) => ({
			block,
			time: block.time,
			saved: claimed.has(block),
			tasks: block.tasks.map((task) => ({
				task,
				saved: taskRoutines.some((r) => isCopyOf(task, block, r)),
			})),
		}));
}

/** What the user picked: blocks to save as block routines, tasks to save as task routines. */
export interface SaveDayPick {
	blocks: Set<Block>;
	tasks: Set<Task>;
}

/** Everything not already a routine, which is what the modal starts with checked. */
export function defaultPick(items: SaveDayBlock[]): SaveDayPick {
	return {
		blocks: new Set(items.filter((i) => !i.saved).map((i) => i.block)),
		tasks: new Set(items.flatMap((i) => i.tasks.filter((t) => !t.saved).map((t) => t.task))),
	};
}

/**
 * The routine drafts for the picked items on `rule`, block routines first, then
 * task routines homed in their block, so the writer nests each task under its
 * block. Items already saved are never drafted, whatever the pick says.
 */
export function saveDayDrafts(items: SaveDayBlock[], pick: SaveDayPick, rule: Rule): RoutineDraft[] {
	const blocks = items
		.filter((i) => !i.saved && pick.blocks.has(i.block))
		.map((i) => blockRepeatDraft(i.block, i.time, rule));
	const tasks = items.flatMap((i) =>
		i.tasks
			.filter((t) => !t.saved && pick.tasks.has(t.task))
			.map((t) => repeatDraft(t.task, i.block, rule)),
	);
	return [...blocks, ...tasks];
}
