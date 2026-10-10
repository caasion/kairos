// Where a dragged task lands on a timeline, and what that drop writes.
//
// One planner for every task drag that ends on a Day or Week timeline, whatever
// view it started in: a Grid cell, the same timeline, or another Week column.
// It's pure — the caller looks up both days' blocks, asks for the outcome, and
// commits it (one day via `applyDayEdit`, two via `applyCrossDayMove`). Keeping
// the decision here means a drop behaves the same from every view.
//
//   drop on a block      same day → nest at the slot; other day → move there
//   drop on empty time   a new block at that time (see writer's NewBlockMode)
//   Ctrl/Cmd held        drop a copy instead; the source day isn't touched
//   Option/Alt held      on empty time, time-box: the task becomes the block

import type { Association, Block, ISODate, Task, TimeRange } from "./types";
import {
	copyTaskIntoBlock,
	copyTaskIntoNewBlock,
	moveTaskIntoBlockAcrossDays,
	nestTaskUnderBlock,
	scheduleTaskInNewBlock,
	scheduleTaskInNewBlockAcrossDays,
	type NewBlockMode,
} from "./writer";

/** A drop position on a timeline, found by hit-testing its DOM. */
export type TimelineDrop =
	| { kind: "block"; date: ISODate; blockLine: number; index: number }
	| { kind: "time"; date: ISODate; time: TimeRange };

/** True when two drops name the same position (or are both absent). */
export function sameDrop(a: TimelineDrop | null, b: TimelineDrop | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind || a.date !== b.date) return false;
  if (a.kind === "block" && b.kind === "block") {
    return a.blockLine === b.blockLine && a.index === b.index;
  }
  if (a.kind === "time" && b.kind === "time") {
    return a.time.start === b.time.start && a.time.end === b.time.end;
  }
  return false;
}

/** One day as the planner sees it. `path` is where its note lives (or will). */
export interface DayBlocks {
	date: ISODate;
	path: string;
	blocks: Block[];
}

/** The dragged task and the block it currently sits in, on `day`. */
export interface DragSource {
	day: DayBlocks;
	owner: Block;
	task: Task;
}

/** Modifier state at release. */
export interface DropModifiers {
	duplicate: boolean;
	timebox: boolean;
}

/** What to commit: one day rewritten, or a task moved between two days. */
export type DropOutcome =
	| { kind: "day"; day: DayBlocks }
	| { kind: "cross"; from: DayBlocks; to: DayBlocks };

function modeOf(mods: DropModifiers): NewBlockMode {
	return mods.timebox ? "timebox" : "container";
}

/**
 * Decide what releasing `source`'s task on `drop` (a position on `target`'s
 * timeline) writes. Null when nothing changes: the destination block is gone,
 * the task can't be lifted (a checkable block's own checkbox), or the result
 * equals the input.
 */
export function planTaskDrop(
	source: DragSource,
	target: DayBlocks,
	drop: TimelineDrop,
	mods: DropModifiers,
): DropOutcome | null {
	const { owner, task } = source;
	const mode = modeOf(mods);
	const destination =
		drop.kind === "block"
			? target.blocks.find((b) => b.source.line === drop.blockLine)
			: undefined;
	if (drop.kind === "block" && !destination) return null;

	// Ctrl/Cmd: a copy lands on the target; the source stays where it is.
	if (mods.duplicate) {
		const assoc: Association | null = task.assoc ?? owner.assoc ?? null;
		const blocks =
			drop.kind === "block"
				? copyTaskIntoBlock(target.blocks, task, assoc, destination!, drop.index)
				: copyTaskIntoNewBlock(target.blocks, task, assoc, target.path, drop.time, mode);
		return blocks === target.blocks ? null : { kind: "day", day: { ...target, blocks } };
	}

	if (source.day.date === target.date) {
		const day = source.day;
		const blocks =
			drop.kind === "block"
				? nestTaskUnderBlock(day.blocks, owner, task, destination!, drop.index)
				: scheduleTaskInNewBlock(day.blocks, owner, task, drop.time, mode);
		return blocks === day.blocks ? null : { kind: "day", day: { ...day, blocks } };
	}

	const { from, to } =
		drop.kind === "block"
			? moveTaskIntoBlockAcrossDays(
					source.day.blocks,
					target.blocks,
					owner,
					task,
					destination!,
					target.path,
					drop.index,
				)
			: scheduleTaskInNewBlockAcrossDays(
					source.day.blocks,
					target.blocks,
					owner,
					task,
					target.path,
					drop.time,
					mode,
				);
	if (from === source.day.blocks && to === target.blocks) return null;
	return {
		kind: "cross",
		from: { ...source.day, blocks: from },
		to: { ...target, blocks: to },
	};
}

/**
 * The title an empty-time drop would give the new block, for the preview the
 * timeline draws under the pointer. Mirrors the writer's `blockForTask`.
 */
export function newBlockLabel(task: Task, owner: Block, mods: DropModifiers): string {
	if (mods.timebox) return task.text;
	const assoc = task.assoc ?? owner.assoc;
	return assoc ? assoc.id : "New block";
}

/** The commit side the index offers; narrowed so the planner's callers can share one. */
export interface DropCommitter {
	applyDayEdit(date: ISODate, path: string, blocks: Block[]): void;
	applyCrossDayMove(
		fromDate: ISODate,
		fromPath: string,
		fromBlocks: Block[],
		toDate: ISODate,
		toPath: string,
		toBlocks: Block[],
	): void;
}

/** Commit a planned drop through the index. */
export function commitTaskDrop(index: DropCommitter, outcome: DropOutcome): void {
	if (outcome.kind === "day") {
		const { date, path, blocks } = outcome.day;
		index.applyDayEdit(date, path, blocks);
		return;
	}
	const { from, to } = outcome;
	index.applyCrossDayMove(from.date, from.path, from.blocks, to.date, to.path, to.blocks);
}
