// Backlog nudge actions — the small, shared write helpers behind resurfacing.
//
// Both the Day timeline and the Grid render surfaced backlog entries as nudges,
// and both offer the same two verbs on them: INSERT (schedule the entry into a
// day, turning it into a real task) and RESURFACE (snooze the entry to a later
// date). Rather than each view reimplementing the index calls, they route
// through here so the behavior stays identical everywhere.
//
// These touch the index (the write surface) but hold no state and no markdown
// logic — the index owns the optimistic commit + file write. `insertEntry` is
// async only because it may create the target daily note first.

import type { BacklogEntry, ISODate } from "./types";
import type { KairosIndex } from "./index";
import { addTaskToUnscheduled } from "./writer";
import { ensureNoteForDate, shiftISO, todayISO } from "./dayNote";

/** A unique-ish negative line for freshly-materialized day tasks (see writer). */
let draftLine = -1;

/**
 * Insert a resurfaced entry into `date`'s daily note as a real task (spec §2.6):
 * the entry leaves the backlog and lands in that day's Unscheduled block,
 * carrying its association forward. Creates the note first if it doesn't exist.
 * This is the arrow action on a nudge — the one deliberate act that commits.
 */
export async function insertEntry(
	index: KairosIndex,
	entry: BacklogEntry,
	date: ISODate,
): Promise<void> {
	const path = await ensureNoteForDate(date);
	index.scheduleEntry(entry, date, path, (blocks) =>
		addTaskToUnscheduled(blocks, path, entry.text, entry.assoc, draftLine--),
	);
}

/**
 * Set an entry's resurface date, rewriting the backlog. `null` clears it (the
 * entry stops surfacing). Matches by source line, the entry's stable handle.
 */
export function setResurface(
	index: KairosIndex,
	entries: BacklogEntry[],
	entry: BacklogEntry,
	resurface: ISODate | null,
): void {
	index.applyBacklogEdit(
		entries.map((e) => {
			if (e.source.line !== entry.source.line) return e;
			if (resurface) return { ...e, resurface };
			const { resurface: _drop, ...rest } = e;
			return rest;
		}),
	);
}

/** Resurface an entry tomorrow (today + 1), regardless of its current date. */
export function resurfaceTomorrow(
	index: KairosIndex,
	entries: BacklogEntry[],
	entry: BacklogEntry,
): void {
	setResurface(index, entries, entry, shiftISO(todayISO(), 1));
}
