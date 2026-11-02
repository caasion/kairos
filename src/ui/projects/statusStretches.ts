// A status history read two ways: as transitions and the stretches between
// them. Each StatusRecord is both. Its date and `why` belong to the transition
// (the moment the status changed, and the reason it did). Its status,
// intensity and `note` (the intention) belong to the stretch that runs from
// that date until the next record. The Projects view's detail pane draws them
// apart (StatusHistory, StatusStrip) so a reason sits on the change it
// explains; the file keeps one record per transition, unchanged.

import type { ISODate, StatusRecord } from "../../types";
import { daysBetween, shiftDays } from "../../gantt/ganttUtils";

export interface Stretch {
	rec: StatusRecord;
	/** The record before, whose stretch this transition ends. Undefined for the first. */
	prev?: StatusRecord;
	start: ISODate;
	/** The next record's date (exclusive), or undefined while it runs on. */
	end?: ISODate;
	/** The stretch in effect today. */
	current: boolean;
	/** Starts after today. */
	future: boolean;
	/** Its length in days: to its end, or to today while it runs on. */
	days: number;
}

/** The stretches of a history, oldest first. */
export function stretchesOf(history: StatusRecord[], today: ISODate): Stretch[] {
	const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const effective = sorted.filter((r) => r.date <= today).at(-1);
	return sorted.map((rec, i) => {
		const end = sorted[i + 1]?.date;
		const future = rec.date > today;
		return {
			rec,
			prev: sorted[i - 1],
			start: rec.date,
			end,
			current: rec === effective,
			future,
			days: future ? 0 : Math.max(1, daysBetween(rec.date, end ?? shiftDays(today, 1))),
		};
	});
}

/** A length of time, short: "1 day", "12 days", "3 mo", "1 yr 2 mo". */
export function formatSpan(days: number): string {
	if (days < 45) return days === 1 ? "1 day" : `${days} days`;
	const months = Math.round(days / 30.44);
	if (months < 12) return `${months} mo`;
	const years = Math.floor(months / 12);
	const rest = months % 12;
	return rest === 0 ? `${years} yr` : `${years} yr ${rest} mo`;
}

/** One stretch's place on the strip, as fractions of its width. */
export interface StripPart {
	stretch: Stretch;
	left: number;
	width: number;
}

/**
 * Lay the stretches along a strip from the first record to today (or to the
 * last scheduled record, if that's later), to scale. A stretch that runs on
 * fills to the end; a scheduled one gets a day.
 */
export function stripOf(stretches: Stretch[], today: ISODate): StripPart[] {
	const first = stretches[0];
	const last = stretches.at(-1);
	if (!first || !last) return [];
	const stripEnd = shiftDays(last.start > today ? last.start : today, 1);
	const total = Math.max(1, daysBetween(first.start, stripEnd));
	return stretches.map((stretch) => {
		const to = stretch.end ?? stripEnd;
		return {
			stretch,
			left: daysBetween(first.start, stretch.start) / total,
			width: Math.max(0, daysBetween(stretch.start, to)) / total,
		};
	});
}

// ── Moving a change by dragging it on the strip ──

/**
 * How far the change dated `date` can move: from the day after the change
 * before it (unbounded for the first) to the day before the change after it.
 * The last change can move up to today, or stay where it is if it's already
 * scheduled later. Changes keep their order, so a drag never swallows one.
 */
export function changeBounds(
	history: StatusRecord[],
	date: ISODate,
	today: ISODate,
): { min?: ISODate; max: ISODate } {
	const dates = history.map((r) => r.date).sort();
	const i = dates.indexOf(date);
	const before = dates[i - 1];
	const after = dates[i + 1];
	return {
		min: before ? shiftDays(before, 1) : undefined,
		max: after ? shiftDays(after, -1) : date > today ? date : today,
	};
}

/** Clamp a dragged-to date into a change's bounds. */
export function clampChange(to: ISODate, bounds: { min?: ISODate; max: ISODate }): ISODate {
	if (bounds.min && to < bounds.min) return bounds.min;
	if (to > bounds.max) return bounds.max;
	return to;
}

/** The history with the change dated `from` moved to `to`, for a drag's preview. */
export function withChangeMoved(history: StatusRecord[], from: ISODate, to: ISODate): StatusRecord[] {
	return history.map((r) => (r.date === from ? { ...r, date: to } : r));
}

/** The strip's first day and its length in days, to turn pixels into days. */
export function stripSpan(stretches: Stretch[], today: ISODate): { start: ISODate; days: number } | null {
	const first = stretches[0];
	const last = stretches.at(-1);
	if (!first || !last) return null;
	const stripEnd = shiftDays(last.start > today ? last.start : today, 1);
	return { start: first.start, days: Math.max(1, daysBetween(first.start, stripEnd)) };
}
