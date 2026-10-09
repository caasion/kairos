// Applying routines to a day — pure, additive, and safe to repeat.
//
// `applyRoutines` folds the routines due on a date into that day's blocks. It
// only ever adds: lines it wrote earlier are ordinary user content by now, so
// nothing is removed or rewritten, and running it twice adds nothing the second
// time. Matching is by exact text and association, never an ID (decision 19):
//   • a block routine is skipped when the day has a block with the same title
//     and the same time;
//   • a task routine is skipped when the day already has a task with the same
//     text and a compatible association (equal, or either side untagged),
//     whatever its status — an open copy carried in from yesterday, or one
//     already done today, both count.
//
// `routinesHash` fingerprints the routines due on one date. The daily note
// records it in frontmatter (`kairos-routines: <hash>`) when routines are
// applied, which is how Kairos tells "already applied" (equal) from "the
// routines for this day changed since" (different) without re-adding things the
// user deliberately deleted. Editing a routine for another day, reordering
// headings, or reformatting whitespace leaves a date's hash unchanged.

import type { Association, Block, ISODate, Task } from "../types";
import { nextDraftLine } from "../draftLine";
import { addTaskToUnscheduled } from "../writer";
import { occursOn } from "./rules";
import type { BlockRoutine, Routine, TaskRoutine } from "./routinesFile";

/** The frontmatter key holding the hash of the routines applied to a day. */
export const ROUTINES_KEY = "kairos-routines";

/** The routines that occur on `date`, in file order. */
export function routinesFor(routines: Routine[], date: ISODate): Routine[] {
	return routines.filter((r) => occursOn(r.rule, date));
}

export interface ApplyResult {
	blocks: Block[];
	/** How many blocks and tasks were added. */
	added: number;
}

/** Whether `routine`'s block or task is already in the day (by the rules above). */
export function isPresent(blocks: Block[], routine: Routine): boolean {
	return routine.kind === "block" ? hasBlock(blocks, routine) : hasTask(blocks, routine);
}

/** The association a routine files under: a task's own or inherited, a block's. */
export function routineAssoc(routine: Routine): Association | undefined {
	return routine.kind === "block" ? routine.assoc : effectiveAssoc(routine);
}

/** Fold the routines due on `date` into `blocks` (a day note at `path`). */
export function applyRoutines(
	blocks: Block[],
	routines: Routine[],
	date: ISODate,
	path: string,
): ApplyResult {
	const due = routinesFor(routines, date);
	let out = blocks;
	let added = 0;

	// Blocks first, so a task homed in a block made today finds it.
	for (const r of due) {
		if (r.kind !== "block" || hasBlock(out, r)) continue;
		out = [...out, makeRoutineBlock(r, path)];
		added++;
	}

	for (const r of due) {
		if (r.kind !== "task" || hasTask(out, r)) continue;
		out = insertTask(out, r, path);
		added++;
	}

	return { blocks: out, added };
}

// ─── matching ──────────────────────────────────────────────────

function sameAssoc(a: Association | undefined, b: Association | undefined): boolean {
	if (!a || !b) return a === b;
	return a.kind === b.kind && a.id === b.id;
}

function hasBlock(blocks: Block[], r: BlockRoutine): boolean {
	return blocks.some(
		(b) =>
			b.title === r.title &&
			b.time?.start === r.time.start &&
			b.time?.end === r.time.end,
	);
}

/** The association a routine task means: its own, else its home line's. */
function effectiveAssoc(r: TaskRoutine): Association | undefined {
	return r.assoc ?? r.inherited;
}

/**
 * Associations that don't contradict each other: equal, or either side has
 * none. A routine with no association matches its text in any block — the task
 * may sit in (and inherit from) a tagged block — and a day task whose tag was
 * removed still counts as that routine's copy.
 */
function compatibleAssoc(a: Association | undefined, b: Association | undefined): boolean {
	return !a || !b || sameAssoc(a, b);
}

function hasTask(blocks: Block[], r: TaskRoutine): boolean {
	const assoc = effectiveAssoc(r);
	return blocks.some((b) => {
		// A checkable block's own line is a task too.
		if (b.status !== undefined && b.title === r.text && compatibleAssoc(b.assoc, assoc)) {
			return true;
		}
		return b.tasks.some(
			(t) => t.text === r.text && compatibleAssoc(t.assoc ?? b.assoc, assoc),
		);
	});
}

// ─── building ──────────────────────────────────────────────────

function makeRoutineBlock(r: BlockRoutine, path: string): Block {
	return {
		source: { path, line: nextDraftLine() },
		title: r.title,
		...(r.assoc ? { assoc: r.assoc } : {}),
		...(r.metadata ? { metadata: r.metadata } : {}),
		tasks: [],
		...(r.checkable ? { status: " " as const } : {}),
		scheduled: true,
		time: r.time,
	};
}

/**
 * Put a routine task in its home block (the first block with that title), or
 * the day's Unscheduled list when it has no home or the day lacks that block.
 * The association is written only when inheriting from the destination block
 * wouldn't already say it — so the line stays literally true either way.
 */
function insertTask(blocks: Block[], r: TaskRoutine, path: string): Block[] {
	const assoc = effectiveAssoc(r);
	const home =
		r.home === undefined
			? undefined
			: (blocks.find((b) => b.title === r.home && b.time) ??
				blocks.find((b) => b.title === r.home));

	if (!home) {
		const next = addTaskToUnscheduled(blocks, path, r.text, assoc);
		return r.metadata ? withMetadata(next, r.metadata) : next;
	}

	const write = r.assoc ?? (sameAssoc(home.assoc, assoc) ? undefined : assoc);
	const task: Task = {
		source: { path, line: nextDraftLine() },
		text: r.text,
		status: " ",
		...(write ? { assoc: write } : {}),
		...(r.metadata ? { metadata: r.metadata } : {}),
	};
	return blocks.map((b) => (b === home ? { ...b, tasks: [...b.tasks, task] } : b));
}

/** Set metadata on the task `addTaskToUnscheduled` just appended. */
function withMetadata(blocks: Block[], metadata: string): Block[] {
	return blocks.map((b) => {
		if (b.time !== undefined || b.title !== "Unscheduled") return b;
		const last = b.tasks[b.tasks.length - 1];
		if (!last) return b;
		return { ...b, tasks: [...b.tasks.slice(0, -1), { ...last, metadata }] };
	});
}

// ─── fingerprint ───────────────────────────────────────────────

function assocKey(a: Association | undefined): string {
	return a ? `${a.kind}:${a.id}` : "";
}

/** One canonical line per due routine: only what changes the day's result. */
function canonical(r: Routine): string {
	if (r.kind === "block") {
		return [
			"B",
			r.time.start,
			r.time.end,
			r.title,
			assocKey(r.assoc),
			r.metadata ?? "",
			r.checkable ? "x" : "",
		].join("\u0001");
	}
	return [
		"T",
		r.home ?? "",
		r.text,
		assocKey(effectiveAssoc(r)),
		r.metadata ?? "",
	].join("\u0001");
}

/**
 * A short, stable fingerprint of the routines due on `date`. Empty string when
 * none are due, so a day without routines never gets the frontmatter key.
 */
export function routinesHash(routines: Routine[], date: ISODate): string {
	const lines = routinesFor(routines, date).map(canonical);
	if (lines.length === 0) return "";
	const unique = [...new Set(lines)].sort();
	return fnv1a(unique.join("\n"));
}

/**
 * True when a day recorded a routines hash and the routines due on it have
 * changed since. A day that never recorded one (`recorded` absent) isn't stale
 * — it was never set up, which the creation trigger handles.
 */
export function routinesStale(
	recorded: string | undefined,
	routines: Routine[],
	date: ISODate,
): boolean {
	if (recorded === undefined || recorded === "") return false;
	return recorded !== routinesHash(routines, date);
}

/** 32-bit FNV-1a over UTF-16 code units, as base36. */
function fnv1a(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}
