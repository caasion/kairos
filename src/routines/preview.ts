// Routine previews — which routines a view should offer for a day.
//
// A preview is a routine that is due on a day and not yet in it. Views (the
// Grid first) show previews as nudges you can pull in one at a time, or all at
// once. Pure and vault-free; the view layer supplies the day's blocks, the
// recorded `kairos-routines` hash, and today's date.
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
// A routine with no association, or whose project/domain has no row in the
// current window, is bucketed into the Unassigned row so it is never invisible.

import type { Association, Block, ISODate } from "../types";
import { missingFrom, routineAssoc, routinesFor, routinesHash } from "./apply";
import type { Routine } from "./routinesFile";

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

/** The key of the Unassigned row, where unfiled routines land. */
export const UNASSIGNED_ROW = "unassigned";

/**
 * Group routines by the row they belong in. `rowKeyFor` maps an association to
 * an existing row's key (undefined when the window has no such row); anything
 * unmapped — or with no association — goes to the Unassigned row.
 */
export function bucketByRow(
	routines: Routine[],
	rowKeyFor: (assoc: Association) => string | undefined,
): Map<string, Routine[]> {
	const out = new Map<string, Routine[]>();
	for (const r of routines) {
		const assoc = routineAssoc(r);
		const key = (assoc && rowKeyFor(assoc)) ?? UNASSIGNED_ROW;
		const list = out.get(key);
		if (list) list.push(r);
		else out.set(key, [r]);
	}
	return out;
}

/** A stable key for a routine within one day (for keyed rendering). */
export function routineKey(r: Routine): string {
	return `${r.kind}:${r.line}`;
}
