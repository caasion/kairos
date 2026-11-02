// Timeline bar edits as pure history rewrites.
//
// A stretch is an `active` record (its opener) running until the next record
// (its closer): an `inactive` closer leaves a gap after it, and any other closer
// is the neighbour it touches. Touching stretches share that one record, which is
// why editing it directly drags the neighbour along. These edits instead change
// only the stretch being held:
//
//  • an edge drag grows or shrinks its own bar. Growing into a neighbour trims
//    the neighbour, which always keeps at least one day; shrinking away from one
//    opens a gap (an `inactive` record) and leaves the neighbour where it was.
//  • a move slides the whole stretch, keeping its length, and stops when it
//    touches a neighbour. It never trims one.
//
// Each edit returns a whole new history, written in one entity replacement, so a
// move never lands half-written. `bounds` gives the dates a gesture may reach, so
// a drag can clamp live; `apply` clamps again, so a caller can't overshoot.

import type { ISODate, StatusRecord } from "../types";
import { daysBetween, shiftDays } from "./ganttUtils";

/** Which date a gesture changes: the opener's, the (exclusive) end, or the
 *  whole stretch, given as its new start. */
export type StretchEditKind = "start" | "end" | "move";

export interface Bounds {
	min: ISODate | null;
	max: ISODate | null;
}

interface Located {
	h: StatusRecord[];
	i: number; // the opener's index
	s: ISODate; // the opener's date
	closer: StatusRecord | undefined;
	gapAfter: boolean; // the closer is an `inactive` record, not a neighbour
}

function sorted(history: readonly StatusRecord[]): StatusRecord[] {
	return [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function locate(history: readonly StatusRecord[], start: ISODate): Located | null {
	const h = sorted(history);
	const i = h.findIndex((r) => r.date === start);
	if (i < 0 || h[i]!.status !== "active") return null;
	const closer = h[i + 1];
	return { h, i, s: start, closer, gapAfter: closer?.status === "inactive" };
}

const later = (a: ISODate, b: ISODate) => (a > b ? a : b);

function clampTo(date: ISODate, { min, max }: Bounds): ISODate {
	if (min && date < min) return min;
	if (max && date > max) return max;
	return date;
}

/**
 * The dates a gesture on the stretch opening at `start` may reach. For "end"
 * the date is the exclusive end (the closer's date); for "start" and "move" it
 * is the stretch's new start. `today` bounds how far a growing edge may trim an
 * open-ended neighbour, which keeps today as its one day. Null for an unknown
 * stretch.
 */
export function stretchBounds(
	history: readonly StatusRecord[],
	start: ISODate,
	kind: StretchEditKind,
	today: ISODate,
): Bounds | null {
	const at = locate(history, start);
	if (!at) return null;
	const { h, i, s, closer, gapAfter } = at;
	const p = h[i - 1];

	if (kind === "end") {
		const min = shiftDays(s, 1);
		if (!closer) return { min, max: null };
		const nIdx = gapAfter ? i + 2 : i + 1;
		const n = h[nIdx];
		if (!n) return { min, max: null };
		if (n.status !== "active") return { min, max: n.date };
		// Trim the next stretch, leaving it one day.
		const nEnd = h[nIdx + 1]?.date;
		return { min, max: nEnd ? shiftDays(nEnd, -1) : later(n.date, today) };
	}

	if (kind === "start") {
		const max = closer ? shiftDays(closer.date, -1) : null;
		if (!p) return { min: null, max };
		if (p.status !== "inactive") return { min: shiftDays(p.date, 1), max };
		const pp = h[i - 2];
		return { min: pp?.status === "active" ? shiftDays(pp.date, 1) : p.date, max };
	}

	// move: slide until touching, never trimming.
	let max: ISODate | null = null;
	if (closer) {
		if (!gapAfter) max = s;
		else {
			const n = h[i + 2];
			max = n ? shiftDays(s, daysBetween(closer.date, n.date)) : null;
		}
	}
	const min = !p ? null : p.status === "inactive" ? p.date : s;
	return { min, max };
}

/** Clamp `to` into what the gesture may reach (unchanged for an unknown stretch). */
export function clampStretchEdit(
	history: readonly StatusRecord[],
	start: ISODate,
	kind: StretchEditKind,
	to: ISODate,
	today: ISODate,
): ISODate {
	const b = stretchBounds(history, start, kind, today);
	return b ? clampTo(to, b) : to;
}

/**
 * Apply a gesture to the stretch opening at `start` and return the new
 * history (sorted; the write path normalizes it). `to` is clamped first. The
 * same history comes back when nothing changes or the stretch is unknown.
 * Moved records keep their note, why and intensity; a gap is a bare
 * `inactive` record.
 */
export function applyStretchEdit(
	history: readonly StatusRecord[],
	start: ISODate,
	kind: StretchEditKind,
	to: ISODate,
	today: ISODate,
): StatusRecord[] {
	const at = locate(history, start);
	if (!at) return [...history];
	const { h, i, s, closer, gapAfter } = at;
	const t = clampStretchEdit(history, start, kind, to, today);
	const opener = h[i]!;
	const p = h[i - 1];

	const remove = new Set<StatusRecord>();
	const add: StatusRecord[] = [];
	const moveRec = (r: StatusRecord, date: ISODate) => {
		remove.add(r);
		add.push({ ...r, date });
	};
	const gap = (date: ISODate) => add.push({ date, status: "inactive" });

	if (kind === "end") {
		if (!closer) gap(t);
		else if (t === closer.date) return h;
		else if (t < closer.date) {
			if (gapAfter) moveRec(closer, t);
			else gap(t);
		} else if (gapAfter) {
			const n = h[i + 2];
			if (n && t >= n.date) {
				remove.add(closer);
				if (t > n.date) moveRec(n, t);
			} else moveRec(closer, t);
		} else moveRec(closer, t); // trim the touching neighbour
	} else if (kind === "start") {
		if (t === s) return h;
		moveRec(opener, t);
		if (t > s) {
			if (p && p.status !== "inactive") gap(s);
		} else if (p?.status === "inactive" && t <= p.date) {
			remove.add(p);
		}
	} else {
		if (t === s) return h;
		const d = daysBetween(s, t);
		moveRec(opener, t);
		if (d > 0) {
			if (p && p.status !== "inactive") gap(s);
		} else if (p?.status === "inactive" && t <= p.date) {
			remove.add(p);
		}
		if (closer) {
			const e2 = shiftDays(closer.date, d);
			if (gapAfter) {
				const n = h[i + 2];
				if (n && e2 >= n.date) remove.add(closer);
				else moveRec(closer, e2);
			} else {
				gap(e2); // d < 0: the clamp stops a rightward move at the neighbour
			}
		}
	}
	return sorted([...h.filter((r) => !remove.has(r)), ...add]);
}

/** True when `at` falls strictly inside the stretch, so a split there leaves two. */
export function canSplitAt(
	history: readonly StatusRecord[],
	start: ISODate,
	at: ISODate,
): boolean {
	const loc = locate(history, start);
	if (!loc) return false;
	return at > start && (!loc.closer || at < loc.closer.date);
}

/**
 * Split the stretch opening at `start` on `at`: a new `active` record there
 * carrying `note` and the stretch's intensity. The caller passes a note that
 * differs from the stretch's own, or the two halves would collapse back into
 * one. Unchanged when `at` isn't strictly inside the stretch.
 */
export function splitStretch(
	history: readonly StatusRecord[],
	start: ISODate,
	at: ISODate,
	note: string,
): StatusRecord[] {
	if (!canSplitAt(history, start, at)) return [...history];
	const opener = sorted(history).find((r) => r.date === start)!;
	const half: StatusRecord = {
		date: at,
		status: "active",
		...(opener.intensity !== undefined ? { intensity: opener.intensity } : {}),
		...(note.trim() ? { note: note.trim() } : {}),
	};
	return sorted([...history, half]);
}

/**
 * The start of the next stretch the one at `start` can merge with: the next
 * `active` record, touching or across a single gap. Null when there's none.
 */
export function mergeableNext(history: readonly StatusRecord[], start: ISODate): ISODate | null {
	const loc = locate(history, start);
	if (!loc?.closer) return null;
	const n = loc.gapAfter ? loc.h[loc.i + 2] : loc.closer;
	return n?.status === "active" ? n.date : null;
}

/**
 * Merge the stretch at `start` with the next one: drop the gap between them and
 * the next stretch's opener, so this one runs through the next one's end and
 * keeps its own intention and intensity.
 */
export function mergeWithNext(history: readonly StatusRecord[], start: ISODate): StatusRecord[] {
	const next = mergeableNext(history, start);
	const loc = locate(history, start);
	if (!next || !loc) return [...history];
	return loc.h.filter((r) => r.date !== next && !(loc.gapAfter && r === loc.closer));
}

/** True when the stretch ends in a gap, so dropping that `inactive` record
 *  lets it run on (to the next record, or open-ended when it's the last). */
export function canRemoveEnd(history: readonly StatusRecord[], start: ISODate): boolean {
	return locate(history, start)?.gapAfter ?? false;
}

export function removeEnd(history: readonly StatusRecord[], start: ISODate): StatusRecord[] {
	const loc = locate(history, start);
	if (!loc?.gapAfter) return [...history];
	return loc.h.filter((r) => r !== loc.closer);
}

/**
 * Delete the stretch at `start`, leaving its days inactive and its neighbours
 * as they were: a stretch it touched keeps its own start, and one before it
 * doesn't run on over the deleted days.
 */
export function deleteStretch(history: readonly StatusRecord[], start: ISODate): StatusRecord[] {
	const loc = locate(history, start);
	if (!loc) return [...history];
	const { h, i, closer, gapAfter } = loc;
	const p = h[i - 1];
	const out = h.filter((r, j) => j !== i && !(gapAfter && r === closer));
	// After an active or archived record, the deleted days need a gap of their own.
	if (p && p.status !== "inactive") out.push({ date: start, status: "inactive" });
	return sorted(out);
}
