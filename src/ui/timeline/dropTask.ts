// Commit a task drag that ended on a block (or empty time) of some day.
//
// The planner (taskDrop.ts) is pure and needs both days' blocks; this is the
// thin view-side wrapper that reads them from the index, creates the target
// day's note when it has none yet, and commits the result. Every drop on a block
// goes through here, so they all write the same thing.

import type { KairosIndex } from "../../index";
import type { Block, ISODate, Task } from "../../types";
import { ensureNoteForDate } from "../../dayNote";
import {
	commitTaskDrop,
	planTaskDrop,
	type DayBlocks,
	type DropModifiers,
	type TimelineDrop,
} from "../../taskDrop";

/** A day's blocks as the index holds them now, or null when it has no note. */
function indexedDay(index: KairosIndex, date: ISODate): DayBlocks | null {
	const day = index.snapshot().days.get(date);
	return day ? { date, path: day.path, blocks: day.blocks } : null;
}

/**
 * Drop `task` (sitting in `owner` on `fromDate`) on `drop`. Returns whether
 * anything was written. The source is read after the target note is ensured,
 * so an await can't leave the plan working from stale blocks.
 */
export async function dropTaskOnTimeline(
	index: KairosIndex,
	fromDate: ISODate,
	owner: Block,
	task: Task,
	drop: TimelineDrop,
	mods: DropModifiers,
): Promise<boolean> {
	const target =
		indexedDay(index, drop.date) ?? {
			date: drop.date,
			path: await ensureNoteForDate(drop.date),
			blocks: [],
		};
	const source = fromDate === drop.date ? target : indexedDay(index, fromDate);
	if (!source) return false;
	const outcome = planTaskDrop({ day: source, owner, task }, target, drop, mods);
	if (!outcome) return false;
	commitTaskDrop(index, outcome);
	return true;
}
