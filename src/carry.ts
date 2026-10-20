// Carry-over — unfinished tasks offered to the next day (spec §4.2, decisions
// 17 and 105).
//
// Today's Day view lists every open or half-done task from the most recent
// earlier daily note, the leftovers, and asks what to do with each: bring it to
// today's Unscheduled list, or mark it done where it is (a task you did but
// forgot to tick). Nothing moves until you say so. "Leave the rest" records
// that today's leftovers were dealt with, as `kairos-carried: <that date>` on
// today's note, and the list goes away. Done and cancelled tasks are never
// offered, and blocks never carry (decision 37) — time is spent or it isn't.
//
// Bringing a task is a MOVE, not a copy: it leaves the earlier note, so there is
// one live copy of every task. A leftover that today already has (same text and
// association, typically a routine task added again today) isn't offered:
// bringing it would stack a second copy.
//
// A task that was only inheriting its block's association gets that association
// written onto it as it moves (materialize-on-move, decisions 22 and 38), so it
// stays in the same project/domain once it's out of the block.
//
// Pure and vault-free; the caller persists both days.

import type { Association, Block, Day, ISODate, Task, TaskStatus } from "./types";
import { copyTaskIntoDay, withoutTask } from "./writer";
import { nextDraftLine } from "./draftLine";

/**
 * The frontmatter key recording that the leftovers from the named day were dealt
 * with. Before decision 105 it meant they had been moved automatically; either
 * way, today's view has nothing left to offer from that day.
 */
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

/** A task left open on an earlier day, with the block it sits in. */
export interface Leftover {
	owner: Block;
	task: Task;
}

/**
 * The leftovers `fromBlocks` offers to a day holding `toBlocks`: its open and
 * half-done tasks, in file order, minus any the day already has.
 */
export function leftovers(fromBlocks: Block[], toBlocks: Block[]): Leftover[] {
	const present = toBlocks.flatMap((b) =>
		b.tasks.map((t) => ({ text: t.text, assoc: t.assoc ?? b.assoc })),
	);
	const out: Leftover[] = [];
	for (const owner of fromBlocks) {
		for (const task of owner.tasks) {
			if (!carries(task.status)) continue;
			const assoc = task.assoc ?? owner.assoc;
			if (present.some((p) => p.text === task.text && sameAssoc(p.assoc, assoc))) continue;
			out.push({ owner, task });
		}
	}
	return out;
}

function sameAssoc(a: Association | undefined, b: Association | undefined): boolean {
	return a?.kind === b?.kind && a?.id === b?.id;
}

/**
 * Move carryable nested tasks from `fromBlocks` into `toBlocks`: every one, or
 * only those `pick` accepts (the tasks the user chose to bring).
 */
export function carryOver(
	fromBlocks: Block[],
	toBlocks: Block[],
	toPath: string,
	pick?: (task: Task) => boolean,
): CarryResult {
	let to = toBlocks;
	let moved = 0;

	const from = fromBlocks.map((block) => {
		let left = block;
		for (const task of block.tasks) {
			if (!carries(task.status) || (pick && !pick(task))) continue;
			const assoc = task.assoc ?? block.assoc ?? null;
			to = copyTaskIntoDay(to, task, toPath, nextDraftLine(), assoc);
			// The block's notes stay beside the tasks that are left.
			left = withoutTask(left, task.source);
			moved++;
		}
		return left;
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
