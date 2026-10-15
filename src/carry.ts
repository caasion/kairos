// Carry-over — unfinished tasks move to the next day (spec §4.2, decision 17).
//
// When a new day starts, every open or half-done task from the most recent
// earlier daily note moves into the new note's Unscheduled list. Done and
// cancelled tasks stay where they are, and blocks never carry (decision 37) —
// time is spent or it isn't.
//
// It is a MOVE, not a copy: the task leaves the earlier note. That keeps exactly
// one live copy of every task, which is what lets a routine skip a task that
// carried in instead of stacking a second one. The earlier note keeps its done
// work as the record of that day.
//
// A task that was only inheriting its block's association gets that association
// written onto it as it moves (materialize-on-move, decisions 22 and 38), so it
// stays in the same project/domain once it's out of the block.
//
// Pure and vault-free; the caller persists both days.

import type { Block, Day, ISODate, Task, TaskStatus } from "./types";
import { copyTaskIntoDay } from "./writer";
import { nextDraftLine } from "./draftLine";

/** The frontmatter key recording which day a note's carried tasks came from. */
export const CARRIED_KEY = "kairos-carried";

/** Open and half-done carry; done and cancelled don't. */
export function carries(status: TaskStatus): boolean {
	return status === " " || status === "/";
}

export interface CarryResult {
	from: Block[];
	to: Block[];
	moved: number;
}

/** Move every carryable nested task from `fromBlocks` into `toBlocks`. */
export function carryOver(
	fromBlocks: Block[],
	toBlocks: Block[],
	toPath: string,
): CarryResult {
	let to = toBlocks;
	let moved = 0;

	const from = fromBlocks.map((block) => {
		const kept: Task[] = [];
		for (const task of block.tasks) {
			if (!carries(task.status)) {
				kept.push(task);
				continue;
			}
			const assoc = task.assoc ?? block.assoc ?? null;
			to = copyTaskIntoDay(to, task, toPath, nextDraftLine(), assoc);
			moved++;
		}
		return kept.length === block.tasks.length ? block : { ...block, tasks: kept };
	});

	return moved === 0 ? { from: fromBlocks, to: toBlocks, moved } : { from, to, moved };
}

/** The most recent day strictly before `date` that has a note, if any. */
export function previousDay(
	days: Map<ISODate, Day>,
	date: ISODate,
): Day | undefined {
	let best: Day | undefined;
	for (const [d, day] of days) {
		if (d < date && (!best || d > best.date)) best = day;
	}
	return best;
}
