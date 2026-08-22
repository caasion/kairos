// Timeline coordinate math — pure date↔pixel mapping for the Timeline view.
//
// Adapted from the Holos plugin's ganttUtils, reworked to be dependency-free
// (no date-fns, no obsidian) so it runs under vitest like projectFile.ts. Dates
// are `YYYY-MM-DD` strings; we parse them at UTC noon and diff in whole days,
// which sidesteps DST and timezone drift entirely.
//
// The view is driven by a calendar *interval* (week / month / quarter / year)
// rather than a free rolling window. A viewport always snaps to whole calendar
// units — a Mon–Sun week, a calendar month, a Jan–Mar quarter, a Jan–Dec year —
// so stepping is by whole units and the header can label real weeks/months.

import type { ISODate } from "../types";

export const ROW_HEIGHT = 34;
export const ROW_GAP = 6;
export const BAR_HEIGHT = 22;
// The header carries two stacked rows: a coarse grouping row over a fine row.
export const HEADER_COARSE_HEIGHT = 20;
export const HEADER_FINE_HEIGHT = 20;
export const HEADER_HEIGHT = HEADER_COARSE_HEIGHT + HEADER_FINE_HEIGHT;
export const LABEL_WIDTH = 160;

// ── Interval presets ─────────────────────────────────────────────────────────
export type Interval = "week" | "month" | "quarter" | "year";
export const INTERVALS: readonly Interval[] = ["week", "month", "quarter", "year"];
export const INTERVAL_LABEL: Record<Interval, string> = {
	week: "Week",
	month: "Month",
	quarter: "Quarter",
	year: "Year",
};

const MS_PER_DAY = 86_400_000;

const MONTHS = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Parse an ISO date at UTC noon (DST-proof anchor for day arithmetic). */
function parseUTCNoon(date: ISODate): number {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return Date.UTC(y, m - 1, d, 12, 0, 0);
}

/** Format a UTC-noon timestamp back to an ISO date. */
function isoFromUTC(ms: number): ISODate {
	const dt = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}` as ISODate;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: ISODate, to: ISODate): number {
	return Math.round((parseUTCNoon(to) - parseUTCNoon(from)) / MS_PER_DAY);
}

/** Shift an ISO date by whole days. */
export function shiftDays(date: ISODate, days: number): ISODate {
	return isoFromUTC(parseUTCNoon(date) + days * MS_PER_DAY);
}

// ── Calendar-unit helpers ────────────────────────────────────────────────────

function year(date: ISODate): number {
	return Number(date.slice(0, 4));
}
function month(date: ISODate): number {
	return Number(date.slice(5, 7)); // 1..12
}
/** Day-of-week 0=Sun..6=Sat at UTC noon. */
function dow(date: ISODate): number {
	return new Date(parseUTCNoon(date)).getUTCDay();
}
/** The Monday on-or-before `date` (ISO weeks start Monday). */
export function startOfWeek(date: ISODate): ISODate {
	const d = dow(date);
	const back = d === 0 ? 6 : d - 1; // Sun → 6 back, Mon → 0, …
	return shiftDays(date, -back);
}

/**
 * ISO-8601 week number (1..53). Week 1 is the week containing the first Thursday
 * of the year; equivalently, weeks are Monday-anchored and numbered by the year
 * of the Thursday in that week.
 */
export function isoWeekNumber(date: ISODate): number {
	// The Thursday of this date's ISO week determines the owning year.
	const monday = startOfWeek(date);
	const thursday = shiftDays(monday, 3);
	const yearStart = `${thursday.slice(0, 4)}-01-01` as ISODate;
	const firstThursday = shiftDays(startOfWeek(yearStart), 3);
	return Math.round(daysBetween(firstThursday, thursday) / 7) + 1;
}
export function startOfMonth(date: ISODate): ISODate {
	return `${date.slice(0, 7)}-01` as ISODate;
}
/** First day of the calendar quarter (Jan/Apr/Jul/Oct) containing `date`. */
export function startOfQuarter(date: ISODate): ISODate {
	const q = Math.floor((month(date) - 1) / 3); // 0..3
	const m = q * 3 + 1;
	return `${date.slice(0, 4)}-${String(m).padStart(2, "0")}-01` as ISODate;
}
export function startOfYear(date: ISODate): ISODate {
	return `${date.slice(0, 4)}-01-01` as ISODate;
}

/** First day of the next calendar month after `date`. */
function startOfNextMonth(date: ISODate): ISODate {
	const y = year(date);
	const m = month(date);
	const ny = m === 12 ? y + 1 : y;
	const nm = m === 12 ? 1 : m + 1;
	return `${ny}-${String(nm).padStart(2, "0")}-01` as ISODate;
}

/** The [start, end] inclusive ISO dates of the unit of `interval` containing `date`. */
export function unitRange(interval: Interval, date: ISODate): { start: ISODate; end: ISODate } {
	switch (interval) {
		case "week": {
			const start = startOfWeek(date);
			return { start, end: shiftDays(start, 6) };
		}
		case "month": {
			const start = startOfMonth(date);
			return { start, end: shiftDays(startOfNextMonth(start), -1) };
		}
		case "quarter": {
			const start = startOfQuarter(date);
			// Advance three months, minus a day.
			let cur = start;
			for (let i = 0; i < 3; i++) cur = startOfNextMonth(cur);
			return { start, end: shiftDays(cur, -1) };
		}
		case "year": {
			const start = startOfYear(date);
			return { start, end: `${date.slice(0, 4)}-12-31` as ISODate };
		}
	}
}

/** Step a viewport-start date by `dir` whole units of `interval`. */
export function stepUnit(interval: Interval, unitStart: ISODate, dir: 1 | -1): ISODate {
	switch (interval) {
		case "week":
			return shiftDays(unitStart, dir * 7);
		case "month": {
			const at = dir === 1 ? startOfNextMonth(unitStart) : shiftDays(unitStart, -1);
			return startOfMonth(at);
		}
		case "quarter": {
			const y = year(unitStart);
			const q = Math.floor((month(unitStart) - 1) / 3); // 0..3
			let nq = q + dir;
			let ny = y;
			if (nq < 0) { nq = 3; ny -= 1; }
			if (nq > 3) { nq = 0; ny += 1; }
			return `${ny}-${String(nq * 3 + 1).padStart(2, "0")}-01` as ISODate;
		}
		case "year":
			return `${year(unitStart) + dir}-01-01` as ISODate;
	}
}

/**
 * The viewport (inclusive start/end) for the unit of `interval` containing
 * `date`. Replaces the old rolling window: the range is always a whole
 * calendar unit so the header can label real weeks/months/quarters.
 */
export function getUnitViewport(
	interval: Interval,
	date: ISODate,
): { start: ISODate; end: ISODate } {
	return unitRange(interval, date);
}

/** A short human label for the current unit (used in the header date button). */
export function unitLabel(interval: Interval, start: ISODate): string {
	const { end } = unitRange(interval, start);
	switch (interval) {
		case "week": {
			const a = `${Number(start.slice(8, 10))} ${MONTHS[month(start) - 1]}`;
			const b = `${Number(end.slice(8, 10))} ${MONTHS[month(end) - 1]}`;
			return `${a} – ${b} ${year(end)}`;
		}
		case "month":
			return `${MONTHS[month(start) - 1]} ${year(start)}`;
		case "quarter":
			return `Q${Math.floor((month(start) - 1) / 3) + 1} ${year(start)}`;
		case "year":
			return String(year(start));
	}
}

// ── Pixel math ───────────────────────────────────────────────────────────────

/** Pixel x of `date` (its left boundary) within a viewport, given px-per-day. */
export function dateToX(date: ISODate, viewportStart: ISODate, pxPerDay: number): number {
	return daysBetween(viewportStart, date) * pxPerDay;
}

/**
 * Inverse of `dateToX`: the ISO date at pixel `x` within a viewport. Rounds to
 * the nearest whole day, so a dragged edge snaps to a day boundary. This is the
 * function drag-to-edit uses to translate a pointer position back into a record
 * date.
 */
export function xToDate(x: ISODate | number, viewportStart: ISODate, pxPerDay: number): ISODate {
	const px = typeof x === "number" ? x : 0;
	const days = pxPerDay > 0 ? Math.round(px / pxPerDay) : 0;
	return shiftDays(viewportStart, days);
}

/**
 * The day-*column* the pixel `x` falls inside (floor, not round). Use this when the
 * intent is "which day is the cursor pointing at" — clicking/creating — as opposed
 * to `xToDate`, which snaps to the nearest day *boundary* for dragging an edge.
 * Rounding would pick the previous day for a click in the left half of a column.
 */
export function xToDay(x: number, viewportStart: ISODate, pxPerDay: number): ISODate {
	const days = pxPerDay > 0 ? Math.floor(x / pxPerDay) : 0;
	return shiftDays(viewportStart, days);
}

/** Total pixel width of a viewport (inclusive of both endpoints). */
export function getViewportWidth(
	viewportStart: ISODate,
	viewportEnd: ISODate,
	pxPerDay: number,
): number {
	return (daysBetween(viewportStart, viewportEnd) + 1) * pxPerDay;
}

// ── Two-level header ticks ───────────────────────────────────────────────────
//
// The header is two stacked rows. Fine ticks carry a label centered in their
// span and a boundary gridline at their *left edge* (so bar edges, which land on
// day boundaries, read against a labeled line — killing the old off-by-one where
// a bar ending "on the 23rd" appeared to end at the 24th). Coarse ticks group the
// fine ones and draw a heavier boundary line.
//
// Per interval:
//   week    → fine = each day,   coarse = the week (single group)
//   month   → fine = each day,   coarse = weeks
//   quarter → fine = weeks,      coarse = months
//   year    → fine = months,     coarse = quarters

export interface FineTick {
	/** Centered label text. */
	label: string;
	/** Pixel x of the tick's left boundary (where the gridline is drawn). */
	gridX: number;
	/** Pixel x for the centered label. */
	labelX: number;
	/** The ISO date of this tick's left boundary (for date-on-line rendering). */
	date: ISODate;
}
export interface CoarseTick {
	label: string;
	/** Pixel x of the group's left boundary. */
	gridX: number;
	/** Pixel x for the centered label. */
	labelX: number;
	/** Width of the group in pixels. */
	width: number;
}
export interface HeaderModel {
	fine: FineTick[];
	coarse: CoarseTick[];
}

function fmtDay(date: ISODate): string {
	return String(Number(date.slice(8, 10)));
}

/**
 * Build the two-level header for `interval` over `[viewportStart, viewportEnd]`.
 * Assumes the viewport is a whole unit (as `getUnitViewport` guarantees).
 */
export function getHeader(
	interval: Interval,
	viewportStart: ISODate,
	viewportEnd: ISODate,
	pxPerDay: number,
): HeaderModel {
	if (pxPerDay <= 0) return { fine: [], coarse: [] };
	const span = daysBetween(viewportStart, viewportEnd); // inclusive → last index
	const xOf = (d: ISODate) => daysBetween(viewportStart, d) * pxPerDay;

	// Helper: emit fine day ticks for every day in the viewport.
	const dayFine = (): FineTick[] => {
		const out: FineTick[] = [];
		for (let i = 0; i <= span; i++) {
			const date = shiftDays(viewportStart, i);
			out.push({
				label: fmtDay(date),
				gridX: i * pxPerDay,
				labelX: i * pxPerDay + pxPerDay / 2,
				date,
			});
		}
		return out;
	};

	// Helper: emit coarse groups by walking week/month/quarter boundaries.
	const groupsBy = (
		nextStart: (d: ISODate) => ISODate,
		label: (start: ISODate) => string,
	): CoarseTick[] => {
		const out: CoarseTick[] = [];
		let cur = viewportStart;
		while (cur <= viewportEnd) {
			const next = nextStart(cur);
			const groupEnd = shiftDays(next, -1); // inclusive last day of this group
			const clampedEnd = groupEnd > viewportEnd ? viewportEnd : groupEnd;
			const left = Math.max(0, xOf(cur));
			const right = xOf(shiftDays(clampedEnd, 1));
			out.push({
				label: label(cur),
				gridX: left,
				labelX: left + (right - left) / 2,
				width: right - left,
			});
			cur = next;
		}
		return out;
	};

	switch (interval) {
		case "week": {
			// Fine = days; coarse = the single week (by ISO week-of-year number).
			const right = xOf(shiftDays(viewportEnd, 1));
			return {
				fine: dayFine(),
				coarse: [{
					label: `Week ${isoWeekNumber(viewportStart)}`,
					gridX: 0,
					labelX: right / 2,
					width: right,
				}],
			};
		}
		case "month": {
			// Fine = days; coarse = weeks (by ISO week-of-year number).
			return {
				fine: dayFine(),
				coarse: groupsBy(
					(d) => shiftDays(startOfWeek(d), 7),
					(s) => `Week ${isoWeekNumber(s)}`,
				),
			};
		}
		case "quarter": {
			// Fine = weeks (Monday-aligned, by ISO week number); coarse = months.
			const fine: FineTick[] = [];
			// Walk week starts; the first fine tick begins at the viewport start
			// (the quarter's first day may be mid-week — its column starts there).
			let cur = viewportStart;
			while (cur <= viewportEnd) {
				const next = shiftDays(startOfWeek(cur), 7);
				const clampedEnd = shiftDays(next, -1) > viewportEnd ? viewportEnd : shiftDays(next, -1);
				const left = xOf(cur);
				const right = xOf(shiftDays(clampedEnd, 1));
				fine.push({
					label: `Week ${isoWeekNumber(cur)}`,
					gridX: Math.max(0, left),
					labelX: left + (right - left) / 2,
					date: cur,
				});
				cur = next;
			}
			return {
				fine,
				// The whole viewport is one quarter → within a single year, so the
				// month bands don't need the year suffix.
				coarse: groupsBy(
					(d) => startOfNextMonth(d),
					(s) => MONTHS[month(s) - 1]!,
				),
			};
		}
		case "year": {
			// Fine = months; coarse = quarters (year is fixed by the viewport, so no
			// year suffix on each quarter band).
			const fine: FineTick[] = [];
			let cur = startOfMonth(viewportStart);
			while (cur <= viewportEnd) {
				const next = startOfNextMonth(cur);
				const clampedEnd = shiftDays(next, -1) > viewportEnd ? viewportEnd : shiftDays(next, -1);
				const left = xOf(cur);
				const right = xOf(shiftDays(clampedEnd, 1));
				fine.push({
					label: MONTHS[month(cur) - 1]!,
					gridX: Math.max(0, left),
					labelX: left + (right - left) / 2,
					date: cur,
				});
				cur = next;
			}
			return {
				fine,
				coarse: groupsBy(
					(d) => stepUnit("quarter", startOfQuarter(d), 1),
					(s) => `Q${Math.floor((month(s) - 1) / 3) + 1}`,
				),
			};
		}
	}
}
