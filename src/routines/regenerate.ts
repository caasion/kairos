// Regenerating a day's routines — bringing a day that already has its
// routines back in line with the current routines file. Pure.
//
// Applying only adds (apply.ts): a block with a routine's title counts as that
// routine whatever its association or time, so after a routine moves to
// another project the blocks already placed keep the old one. Regenerating
// compares instead, and lists what differs as changes the user picks from:
//   • "assoc"      a routine block whose association differs from the routine;
//   • "task-assoc" a routine task (same text) whose association contradicts
//                  the routine's, and won't follow its block's change;
//   • "task"       a routine task missing from its home block, which the day has;
//   • "missing"    a routine missing from the day entirely: a block, or a task
//                  whose home the day doesn't have (or that has none);
//   • "time"       a routine block at another time than the routine's — off by
//                  default, since a block is often moved on purpose.
// Nothing is ever removed, no task's status changes, and tasks the user added
// inside a routine block stay. Matching follows apply.ts: blocks by title
// (`claimBlocks`), tasks by text — here regardless of association, since a
// routine whose project changed should update its copy, not add a second one.

import type { Association, Block, Task, TimeRange } from "../types";
import {
	claimBlocks,
	compatibleAssoc,
	effectiveAssoc,
	insertTask,
	makeRoutineBlock,
	sameAssoc,
} from "./apply";
import type { BlockRoutine, Routine, TaskRoutine } from "./routinesFile";

export type RegenChange =
	| {
			kind: "assoc";
			key: string;
			routine: BlockRoutine;
			block: Block;
			from?: Association;
			to?: Association;
	  }
	| {
			kind: "task-assoc";
			key: string;
			routine: TaskRoutine;
			block: Block;
			task: Task;
			from?: Association;
			to?: Association;
	  }
	| { kind: "time"; key: string; routine: BlockRoutine; block: Block; from: TimeRange; to: TimeRange }
	| { kind: "task"; key: string; routine: TaskRoutine; home: string }
	| { kind: "missing"; key: string; routine: Routine };

export type RegenKind = RegenChange["kind"];

/** Whether a kind of change is picked before the user looks: all but time. */
export function checkedByDefault(kind: RegenKind): boolean {
	return kind !== "time";
}

/** A change's key: its kind and the routine's line in the routines file. */
const keyOf = (kind: RegenKind, r: Routine) => `${kind}:${r.line}`;

/**
 * What differs between a day's `blocks` and the routines `due` on it (already
 * filtered to the date and to active owners), in routine order. Empty when
 * the day matches.
 */
export function regenerateChanges(blocks: Block[], due: Routine[]): RegenChange[] {
	const claims = claimBlocks(blocks, due);
	const changes: RegenChange[] = [];

	// The association each claimed block will have once its "assoc" change
	// applies, so a task inheriting from it isn't flagged twice.
	const blockAssocAfter = new Map<Block, Association | undefined>();

	for (const r of due) {
		if (r.kind !== "block") continue;
		const block = claims.get(r);
		if (!block) {
			changes.push({ kind: "missing", key: keyOf("missing", r), routine: r });
			continue;
		}
		if (!sameAssoc(block.assoc, r.assoc)) {
			changes.push({
				kind: "assoc",
				key: keyOf("assoc", r),
				routine: r,
				block,
				...(block.assoc ? { from: block.assoc } : {}),
				...(r.assoc ? { to: r.assoc } : {}),
			});
			blockAssocAfter.set(block, r.assoc);
		}
		if (block.time && (block.time.start !== r.time.start || block.time.end !== r.time.end)) {
			changes.push({
				kind: "time",
				key: keyOf("time", r),
				routine: r,
				block,
				from: block.time,
				to: r.time,
			});
		}
	}

	const assocAfter = (b: Block) => (blockAssocAfter.has(b) ? blockAssocAfter.get(b) : b.assoc);
	const used = new Set<Task>();

	for (const r of due) {
		if (r.kind !== "task") continue;
		const want = effectiveAssoc(r);
		const homes = blocks.filter((b) => r.home !== undefined && b.title === r.home);
		const found = findCopy(blocks, homes, r, used, assocAfter);
		if (found) {
			used.add(found.task);
			const { task, block } = found;
			if (compatibleAssoc(task.assoc ?? assocAfter(block), want)) continue;
			// Write the routine's own tag; an inherited one only when the block
			// won't say it, so the line stays literally true either way.
			const to = r.assoc ?? (sameAssoc(assocAfter(block), want) ? undefined : want);
			changes.push({
				kind: "task-assoc",
				key: keyOf("task-assoc", r),
				routine: r,
				block,
				task,
				...(task.assoc ? { from: task.assoc } : block.assoc ? { from: block.assoc } : {}),
				...(to ? { to } : {}),
			});
			continue;
		}
		if (r.home !== undefined && homes.length > 0) {
			changes.push({ kind: "task", key: keyOf("task", r), routine: r, home: r.home });
		} else {
			changes.push({ kind: "missing", key: keyOf("missing", r), routine: r });
		}
	}

	return changes;
}

/**
 * The day task that is `r`'s copy, by text: one whose association agrees
 * with the routine first (in its home block, then anywhere), else any with
 * that text (home first). Tasks already taken by an earlier routine are skipped.
 */
function findCopy(
	blocks: Block[],
	homes: Block[],
	r: TaskRoutine,
	used: Set<Task>,
	assocAfter: (b: Block) => Association | undefined,
): { task: Task; block: Block } | undefined {
	const want = effectiveAssoc(r);
	const candidates = (from: Block[]) =>
		from.flatMap((block) =>
			block.tasks
				.filter((task) => task.text === r.text && !used.has(task))
				.map((task) => ({ task, block })),
		);
	const inHome = candidates(homes);
	const anywhere = candidates(blocks);
	const agrees = (c: { task: Task; block: Block }) =>
		compatibleAssoc(c.task.assoc ?? assocAfter(c.block), want);
	return inHome.find(agrees) ?? anywhere.find(agrees) ?? inHome[0] ?? anywhere[0];
}

/**
 * The day's blocks with `changes` applied (a subset of what
 * `regenerateChanges` returned for these same `blocks`). Blocks and tasks keep
 * their place, status and everything not named by a change; missing blocks
 * are appended, then missing tasks go to their homes (a block added here
 * counts) or the day's Unscheduled list, as applying does.
 */
export function applyRegenerate(blocks: Block[], changes: RegenChange[], path: string): Block[] {
	const blockEdits = new Map<Block, Partial<Block>>();
	const taskEdits = new Map<Task, Association | undefined>();
	const added: Routine[] = [];

	for (const c of changes) {
		switch (c.kind) {
			case "assoc":
				blockEdits.set(c.block, { ...blockEdits.get(c.block), assoc: c.to });
				break;
			case "time":
				blockEdits.set(c.block, { ...blockEdits.get(c.block), time: c.to });
				break;
			case "task-assoc":
				taskEdits.set(c.task, c.to);
				break;
			case "task":
			case "missing":
				added.push(c.routine);
				break;
		}
	}

	let out = blocks.map((b) => {
		const edit = blockEdits.get(b);
		const touchesTasks = b.tasks.some((t) => taskEdits.has(t));
		if (!edit && !touchesTasks) return b;
		let next: Block = { ...b, ...edit };
		if (edit && "assoc" in edit && edit.assoc === undefined) delete next.assoc;
		if (touchesTasks) {
			next = {
				...next,
				tasks: b.tasks.map((t) => (taskEdits.has(t) ? withAssoc(t, taskEdits.get(t)) : t)),
			};
		}
		return next;
	});

	// Blocks first, so a task homed in a block added here finds it.
	for (const r of added) if (r.kind === "block") out = [...out, makeRoutineBlock(r, path)];
	for (const r of added) if (r.kind === "task") out = insertTask(out, r, path);
	return out;
}

function withAssoc(task: Task, assoc: Association | undefined): Task {
	const next: Task = { ...task };
	delete next.assoc;
	return assoc ? { ...next, assoc } : next;
}
