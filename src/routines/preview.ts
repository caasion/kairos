// Routine previews — which routines a view should offer for a day.
//
// A preview is a routine that is due on a day and not yet in it. Every view
// shows a day's previews the same way: one compact routines alert (a bar in the
// Day view, a pill on the Week and Grid column headers) that opens into a list
// on hover, with "Add all". Pure and vault-free; the view layer supplies the
// day's blocks, the recorded `kairos-routines` hash, and today's date.
//
// Whether a day shows previews at all follows the recorded hash (decision B):
//
//   date          kairos-routines            previews
//   ────────────  ─────────────────────────  ─────────────────────────────────
//   past          —                          none (routines plan ahead)
//   today/future  absent                     everything missing
//   today/future  equal to the current hash  none — anything missing was
//                                            deleted on purpose
//   today/future  different                  everything missing again
//
// Routines whose project or domain isn't active that day are left out before
// they get here (owners.ts).

import type { Block, ISODate } from "../types";
import { missingFrom, routinesFor, routinesHash } from "./apply";
import { activeRoutines, type OwnerActive } from "./owners";
import type { BlockRoutine, Routine, TaskRoutine } from "./routinesFile";

/** Routines due on `date` that the day doesn't contain yet, in file order. */
export function missingRoutines(
	blocks: Block[],
	routines: Routine[],
	date: ISODate,
): Routine[] {
	return missingFrom(blocks, routinesFor(routines, date));
}

export interface PreviewDay {
	date: ISODate;
	today: ISODate;
	/** The day's `kairos-routines` value, if its note has one. */
	recorded?: string;
	routines: Routine[];
}

/** Whether a day should show routine previews at all (see the table above). */
export function showsPreviews(day: PreviewDay): boolean {
	if (day.date < day.today) return false;
	if (day.recorded === undefined) return true;
	return day.recorded !== routinesHash(day.routines, day.date);
}

/** The previews for one day: nothing unless `showsPreviews`, else what's missing. */
export function previewRoutines(day: PreviewDay & { blocks: Block[] }): Routine[] {
	return showsPreviews(day) ? missingRoutines(day.blocks, day.routines, day.date) : [];
}

/** What a view's routines alert offers for one day: the active, missing ones, listed. */
export function routinesToOffer(
	day: PreviewDay & { blocks: Block[]; active?: OwnerActive },
): RoutineList {
	const routines = activeRoutines(day.routines, day.date, day.active);
	return listRoutines(previewRoutines({ ...day, routines }));
}

/**
 * One line of a day's routines list, and what adding it writes. A block routine
 * comes with the task routines homed in it, and is added as a whole: routines
 * go in together, not task by task. A task routine whose block is already in
 * the day (or that names a home with no routine of its own) is its own item.
 */
export interface RoutineItem {
	key: string;
	/** The block routine, for a block item. */
	block?: BlockRoutine;
	/** The block's tasks, or the one task of a task item. */
	tasks: TaskRoutine[];
	/** Everything adding this item writes, block first. */
	routines: Routine[];
}

export interface RoutineList {
	/** Block items by start time, then tasks that name a home block. */
	items: RoutineItem[];
	/** Tasks with no block, listed last and muted: allowed, but discouraged. */
	loose: RoutineItem[];
	/** How many routines in all. */
	count: number;
}

/** Arrange a day's missing routines for the routines alert. */
export function listRoutines(missing: Routine[]): RoutineList {
	const blocks = missing
		.filter((r): r is BlockRoutine => r.kind === "block")
		.sort((a, b) => a.time.start - b.time.start || a.time.end - b.time.end);
	const tasks = missing.filter((r): r is TaskRoutine => r.kind === "task");
	const claimed = new Set<TaskRoutine>();

	const items: RoutineItem[] = blocks.map((block) => {
		const own = tasks.filter((t) => !claimed.has(t) && t.home === block.title);
		for (const t of own) claimed.add(t);
		return { key: routineKey(block), block, tasks: own, routines: [block, ...own] };
	});
	const single = (t: TaskRoutine): RoutineItem => ({ key: routineKey(t), tasks: [t], routines: [t] });
	const rest = tasks.filter((t) => !claimed.has(t));
	items.push(...rest.filter((t) => t.home).map(single));
	const loose = rest.filter((t) => !t.home).map(single);
	return { items, loose, count: missing.length };
}

/** A stable key for a routine within one day (for keyed rendering). */
export function routineKey(r: Routine): string {
	return `${r.kind}:${r.line}`;
}
