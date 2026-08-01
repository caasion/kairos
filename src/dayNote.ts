// Day-note routing — mapping a calendar date to its daily note.
//
// The Day view owns a *date*, not a file. This module is the seam between that
// date and the vault: it resolves a date to an existing note's path (if any) and
// creates the note on demand. It is the only place the view touches the Daily
// Notes plugin, so the view code stays free of that dependency.
//
// All date I/O uses `obsidian-daily-notes-interface`, the same package the index
// uses for `getDateFromPath`, so a note this module finds/creates is a note the
// index will classify as a `day` (their folder + format config agree).

import { moment } from "obsidian";
import type { TFile } from "obsidian";
import {
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
} from "obsidian-daily-notes-interface";
import type { ISODate } from "./types";

const ISO = "YYYY-MM-DD";

/** Today's date as an ISO string, in the user's local timezone. */
export function todayISO(): ISODate {
	return moment().format(ISO);
}

/** Shift an ISO date by whole days (negative = earlier). */
export function shiftISO(date: ISODate, days: number): ISODate {
	return moment(date, ISO).add(days, "day").format(ISO);
}

/** An ISO date from a JS `Date` (the calendar popup speaks in `Date`s). */
export function isoFromDate(date: Date): ISODate {
	return moment(date).format(ISO);
}

/** A JS `Date` at local midnight for an ISO date (to seed the calendar popup). */
export function dateFromISO(date: ISODate): Date {
	return moment(date, ISO).toDate();
}

/**
 * The path of the existing daily note for `date`, or `null` if none exists yet.
 * Never creates anything — a view can show an empty day without touching disk.
 */
export function notePathForDate(date: ISODate): string | null {
	const note = existingNote(date);
	return note ? note.path : null;
}

/**
 * Resolve the daily note for `date`, creating it if it does not exist. Returns
 * the note path. Used when an action must write into a day (creating a block, or
 * an explicit "open this day's note").
 */
export async function ensureNoteForDate(date: ISODate): Promise<string> {
	const existing = existingNote(date);
	if (existing) return existing.path;
	const created = await createDailyNote(moment(date, ISO));
	if (!created) {
		throw new Error(`Kairos: could not create daily note for ${date}`);
	}
	return created.path;
}

/** The `TFile` for an existing daily note on `date`, or `undefined`. */
function existingNote(date: ISODate): TFile | undefined {
	// `getDailyNote` throws if the Daily Notes plugin is misconfigured; treat any
	// failure as "no note" so the view degrades to an empty day rather than crashing.
	try {
		return getDailyNote(moment(date, ISO), getAllDailyNotes()) ?? undefined;
	} catch {
		return undefined;
	}
}
