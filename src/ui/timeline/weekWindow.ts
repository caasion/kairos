// Week-window arithmetic — which days the Week view shows, and where the
// arrows take it.
//
// The Week view is a rolling window, not a calendar week: the settings give a
// span around today ([today − before, today + after], each side 1–7 days) and
// the window keeps that width as the arrows walk it. Holos drove the equivalent
// view from a column *count* plus a separately-moved start date, and the two
// could disagree — caasion/holos#108 reported "Today" landing on a window with
// today missing from it, and arrows that skipped a day. Here there is only one
// number: the width comes from the span, and the arrows step by exactly that
// width, so nothing can drift out of agreement.
//
// Pure and Svelte-free (like layout.ts next door) so every span can be pinned
// down in a unit test instead of checked by eye in the running plugin.

import { shiftDays } from "../../gantt/ganttUtils";
import type { ISODate } from "../../types";

/** Each side of the window spans 1–7 days — the settings sliders' limits. */
export const MIN_SPAN = 1;
export const MAX_SPAN = 7;

/**
 * Coerce a stored span into the 1–7 the sliders promise. A non-finite value —
 * a hand-edited or truncated data.json — falls back to MIN_SPAN instead of
 * propagating NaN, which would otherwise size the window to zero columns.
 */
export function clampSpan(n: number): number {
	const v = Math.floor(n);
	if (Number.isNaN(v)) return MIN_SPAN;
	return Math.max(MIN_SPAN, Math.min(MAX_SPAN, v));
}

/**
 * How many columns a span renders: both sides, plus the day they are measured
 * from. This is the view's only notion of width — there is no separate column
 * count that could fall out of step with it.
 */
export function windowWidth(before: number, after: number): number {
	return clampSpan(before) + clampSpan(after) + 1;
}

/**
 * The window's first day when `date` is to sit in its usual place: `before`
 * days in. "Today" and a calendar jump both go through here, so a jumped-to day
 * lands exactly where today would have.
 */
export function anchorFor(date: ISODate, before: number): ISODate {
	return shiftDays(date, -clampSpan(before));
}

/** The days of the window starting at `anchor`, in order. */
export function windowDates(anchor: ISODate, width: number): ISODate[] {
	const count = Math.max(0, Math.floor(width));
	return Array.from({ length: count }, (_, i) => shiftDays(anchor, i));
}

/**
 * Walk the window whole: `steps` counts windows, not days. Stepping by the full
 * width is what makes consecutive windows abut exactly — no day is shown twice
 * and none is stepped over.
 */
export function stepAnchor(
	anchor: ISODate,
	width: number,
	steps: number,
): ISODate {
	return shiftDays(anchor, width * steps);
}
