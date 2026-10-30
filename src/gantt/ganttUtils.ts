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

export const ROW_HEIGHT = 38;
export const ROW_GAP = 6;
export const BAR_HEIGHT = 26;
// Space above and below a row label, the Grid's row-label padding. The label
// sits at the top of its row like the Grid's, and a row grows to fit a name
// with a two-line note.
export const LABEL_PAD_Y = 8;
// The header carries two stacked rows: a coarse grouping row over a fine row.
export const HEADER_COARSE_HEIGHT = 20;
export const HEADER_FINE_HEIGHT = 20;
export const HEADER_HEIGHT = HEADER_COARSE_HEIGHT + HEADER_FINE_HEIGHT;

/**
 * A row's height: ROW_HEIGHT, or taller when its label (measured, in px) needs
 * more room. The bar stays level with the label's first line (`barOffset`).
 */
export function rowHeightFor(labelHeight: number | undefined): number {
	return Math.max(ROW_HEIGHT, Math.ceil(labelHeight ?? 0) + 2 * LABEL_PAD_Y);
}

/** A bar's offset from its row's top: centered in a ROW_HEIGHT row, so it
 * lines up with the label's name in a row of any height. */
export const BAR_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;

/** Each row's top, starting at `start`, with ROW_GAP between rows. */
export function rowTops(heights: readonly number[], start: number): number[] {
	const tops: number[] = [];
	let y = start;
	for (const h of heights) {
		tops.push(y);
		y += h + ROW_GAP;
	}
	return tops;
}

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
	return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
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
	const yearStart = `${thursday.slice(0, 4)}-01-01`;
	const firstThursday = shiftDays(startOfWeek(yearStart), 3);
	return Math.round(daysBetween(firstThursday, thursday) / 7) + 1;
}
export function startOfMonth(date: ISODate): ISODate {
	return `${date.slice(0, 7)}-01`;
}
/** First day of the calendar quarter (Jan/Apr/Jul/Oct) containing `date`. */
export function startOfQuarter(date: ISODate): ISODate {
	const q = Math.floor((month(date) - 1) / 3); // 0..3
	const m = q * 3 + 1;
	return `${date.slice(0, 4)}-${String(m).padStart(2, "0")}-01`;
}
export function startOfYear(date: ISODate): ISODate {
	return `${date.slice(0, 4)}-01-01`;
}

/** First day of the next calendar month after `date`. */
function startOfNextMonth(date: ISODate): ISODate {
	const y = year(date);
	const m = month(date);
	const ny = m === 12 ? y + 1 : y;
	const nm = m === 12 ? 1 : m + 1;
	return `${ny}-${String(nm).padStart(2, "0")}-01`;
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
			return { start, end: `${date.slice(0, 4)}-12-31` };
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
			return `${ny}-${String(nq * 3 + 1).padStart(2, "0")}-01`;
		}
		case "year":
			return `${year(unitStart) + dir}-01-01`;
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

/**
 * Shift an ISO date by whole calendar months. The day stays where the target
 * month has it, and is pulled back to the month's last day where it doesn't
 * (31 Jan + 1 → 28 Feb).
 */
export function shiftMonths(date: ISODate, months: number): ISODate {
	const total = year(date) * 12 + (month(date) - 1) + months;
	const y = Math.floor(total / 12);
	const m = total - y * 12 + 1;
	const mm = String(m).padStart(2, "0");
	const last = Number(shiftDays(startOfNextMonth(`${y}-${mm}-01`), -1).slice(8, 10));
	const d = Math.min(Number(date.slice(8, 10)), last);
	return `${y}-${mm}-${String(d).padStart(2, "0")}`;
}

// ── The Timeline's range ─────────────────────────────────────────────────────
// The range is one unit of the interval long, but it needn't start on a unit
// boundary: the small arrows step it one unit down (Week → a day, Month → a
// week, Quarter → a month, Year → a quarter), so a Month view can sit at
// 8 Oct – 7 Nov. Every step is a plain shift, so back undoes forward exactly.
// "Today", the calendar and a change of interval snap it back to a whole unit.

function shiftBy(interval: Interval, date: ISODate, units: number): ISODate {
	switch (interval) {
		case "week":
			return shiftDays(date, units * 7);
		case "month":
			return shiftMonths(date, units);
		case "quarter":
			return shiftMonths(date, units * 3);
		case "year":
			return shiftMonths(date, units * 12);
	}
}

/** The unit one step down from `interval`, which the small arrows move by. */
export const SUB_UNIT: Record<Interval, "day" | "week" | "month" | "quarter"> = {
	week: "day",
	month: "week",
	quarter: "month",
	year: "quarter",
};

/** The [start, end] inclusive dates of the range one `interval` long from `start`. */
export function viewRange(interval: Interval, start: ISODate): { start: ISODate; end: ISODate } {
	return { start, end: shiftDays(shiftBy(interval, start, 1), -1) };
}

/**
 * Where the range starts after one press of an arrow: `big` moves it a whole
 * unit of `interval`, otherwise one unit down (SUB_UNIT).
 */
export function stepView(interval: Interval, start: ISODate, dir: 1 | -1, big: boolean): ISODate {
	if (big) return shiftBy(interval, start, dir);
	switch (SUB_UNIT[interval]) {
		case "day":
			return shiftDays(start, dir);
		case "week":
			return shiftDays(start, dir * 7);
		case "month":
			return shiftMonths(start, dir);
		case "quarter":
			return shiftMonths(start, dir * 3);
	}
}

/**
 * The header date button's label for the range starting at `start`: the
 * unit's own name when the range is a whole unit ("Oct 2026", "Q4 2026"),
 * otherwise the dates or months it runs between.
 */
export function viewLabel(interval: Interval, start: ISODate): string {
	if (unitRange(interval, start).start === start) return unitLabel(interval, start);
	const { end } = viewRange(interval, start);
	const sameYear = year(start) === year(end);
	if (interval === "week" || interval === "month") {
		const day = (d: ISODate) => `${Number(d.slice(8, 10))} ${MONTHS[month(d) - 1]}`;
		return sameYear
			? `${day(start)} – ${day(end)} ${year(end)}`
			: `${day(start)} ${year(start)} – ${day(end)} ${year(end)}`;
	}
	const mon = (d: ISODate) => MONTHS[month(d) - 1]!;
	return sameYear
		? `${mon(start)} – ${mon(end)} ${year(end)}`
		: `${mon(start)} ${year(start)} – ${mon(end)} ${year(end)}`;
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

/**
 * The active period a create-drag writes, from the day column pressed to the
 * column released on. Both columns are part of the period, so it closes on the
 * day after the later one: a span ends at its closing record's date, which the
 * span doesn't include. Dragging leftwards gives the same period.
 */
export function dragPeriod(pressed: ISODate, released: ISODate): { start: ISODate; end: ISODate } {
	const [first, last] = pressed <= released ? [pressed, released] : [released, pressed];
	return { start: first, end: shiftDays(last, 1) };
}

/**
 * How far a create-drag pressed on `date` may reach: the dates of the nearest
 * records strictly before and after it (null when there's none). The released
 * column stays strictly between them, so the new period never swallows a
 * record. A record on `date` itself bounds neither side; the period's start
 * replaces it, as a click there would.
 */
export function dragBounds(
	history: readonly { date: ISODate }[],
	date: ISODate,
): { lower: ISODate | null; upper: ISODate | null } {
	let lower: ISODate | null = null;
	let upper: ISODate | null = null;
	for (const r of history) {
		if (r.date < date) lower = r.date;
		else if (r.date > date && upper === null) upper = r.date;
	}
	return { lower, upper };
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
 * The viewport is one unit long but may start mid-unit (`viewRange`), so the
 * bands are walked from its first day rather than assumed whole.
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
			// Fine = days; coarse = the week (by ISO week-of-year number), or the
			// two it straddles once the small arrows have moved it off a Monday.
			return {
				fine: dayFine(),
				coarse: groupsBy(
					(d) => shiftDays(startOfWeek(d), 7),
					(s) => `Week ${isoWeekNumber(s)}`,
				),
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
				// Three months fit without a year on each band; when the range
				// crosses a year, the header date button names both.
				coarse: groupsBy(
					(d) => startOfNextMonth(d),
					(s) => MONTHS[month(s) - 1]!,
				),
			};
		}
		case "year": {
			// Fine = months; coarse = quarters (no year suffix on each band; the
			// header date button names the year, or both when the range crosses one).
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
