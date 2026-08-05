// Gantt coordinate math — pure date↔pixel mapping for the strength view.
//
// Adapted from the Holos plugin's ganttUtils, reworked to be dependency-free
// (no date-fns, no obsidian) so it runs under vitest like projectFile.ts. Dates
// are `YYYY-MM-DD` strings; we parse them at UTC noon and diff in whole days,
// which sidesteps DST and timezone drift entirely.

import type { ISODate } from "../types";

export const ROW_HEIGHT = 34;
export const ROW_GAP = 6;
export const BAR_HEIGHT = 22;
export const HEADER_HEIGHT = 28;
export const LABEL_WIDTH = 160;

/** Standard window-size presets, in days. */
export const WINDOW_PRESETS = [30, 60, 90, 180, 365] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];

const MS_PER_DAY = 86_400_000;

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

/**
 * A viewport centered on `center` (defaults to `today`) spanning exactly
 * `windowDays` days. Mirrors Holos' rolling window: half the window before the
 * center, the remainder after.
 */
export function getRollingViewport(
	windowDays: number,
	center: ISODate,
): { start: ISODate; end: ISODate } {
	const half = Math.floor(windowDays / 2);
	return {
		start: shiftDays(center, -half),
		end: shiftDays(center, windowDays - half - 1),
	};
}

/** Pixel x of `date` within a viewport, given pixels-per-day. */
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

export interface HeaderTick {
	label: string;
	/** Pixel offset for the centered label. */
	x: number;
	/** Pixel offset for the left-edge grid line. */
	gridX: number;
}

const MONTHS = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Header ticks whose granularity is inferred from `pxPerDay`:
 *  - >= 18 → one tick per day
 *  - >= 5  → one tick per week (Monday-aligned)
 *  - else  → one tick per month
 */
export function getHeaderTicks(
	viewportStart: ISODate,
	viewportEnd: ISODate,
	pxPerDay: number,
): HeaderTick[] {
	if (pxPerDay <= 0) return [];
	const span = daysBetween(viewportStart, viewportEnd);

	// ── Daily ──
	if (pxPerDay >= 18) {
		const ticks: HeaderTick[] = [];
		for (let i = 0; i <= span; i++) {
			const date = shiftDays(viewportStart, i);
			ticks.push({
				label: String(Number(date.slice(8, 10))),
				x: i * pxPerDay + pxPerDay / 2,
				gridX: i * pxPerDay,
			});
		}
		return ticks;
	}

	// ── Weekly (Monday-aligned) ──
	if (pxPerDay >= 5) {
		const ticks: HeaderTick[] = [];
		// Find the first Monday on-or-after viewportStart.
		const startDow = new Date(parseUTCNoon(viewportStart)).getUTCDay(); // 0=Sun
		const toMonday = (8 - (startDow === 0 ? 7 : startDow)) % 7;
		for (let i = toMonday; i <= span; i += 7) {
			const date = shiftDays(viewportStart, i);
			const [, mm, dd] = date.split("-");
			ticks.push({
				label: `${Number(dd)} ${MONTHS[Number(mm) - 1]}`,
				x: i * pxPerDay + (7 * pxPerDay) / 2,
				gridX: i * pxPerDay,
			});
		}
		return ticks;
	}

	// ── Monthly ──
	const ticks: HeaderTick[] = [];
	const multiYear = viewportStart.slice(0, 4) !== viewportEnd.slice(0, 4);
	// Walk month firsts from the month of viewportStart.
	let cursor = `${viewportStart.slice(0, 7)}-01` as ISODate;
	while (cursor <= viewportEnd) {
		const offset = daysBetween(viewportStart, cursor);
		const yy = cursor.slice(0, 4);
		const mm = Number(cursor.slice(5, 7));
		const daysInMonth = new Date(Date.UTC(Number(yy), mm, 0)).getUTCDate();
		ticks.push({
			label: multiYear ? `${MONTHS[mm - 1]} ${yy.slice(2)}` : MONTHS[mm - 1]!,
			x: offset * pxPerDay + (daysInMonth * pxPerDay) / 2,
			gridX: Math.max(0, offset) * pxPerDay,
		});
		// Advance to the first of the next month.
		const nextMonth = mm === 12 ? 1 : mm + 1;
		const nextYear = mm === 12 ? Number(yy) + 1 : Number(yy);
		cursor = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01` as ISODate;
	}
	return ticks;
}
