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

import type { BacklogEntry, Block, ISODate, Task } from "./types";
import type { KairosIndex } from "./index";
import { addTaskToUnscheduled, deleteTask } from "./writer";
import { ensureNoteForDate, shiftISO, todayISO } from "./dayNote";
import { nextDraftLine } from "./draftLine";

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
		addTaskToUnscheduled(blocks, path, entry.text, entry.assoc, nextDraftLine()),
	);
}

/**
 * The reverse of `insertEntry`: move a day task back into the backlog (spec
 * §2.6, §4.2 "special delete"). The task leaves its block and reappears as a
 * fresh backlog entry carrying its text and association; no resurface date is
 * set, and nothing links the entry back to the task it came from.
 *
 * Materialize-on-move (spec §4.3): a task that was only *inheriting* its block's
 * association would land in the backlog unassociated, so the inherited owner is
 * pinned onto the new entry.
 *
 * Colocated tasks (a checkable block's own line) are not liftable — that task
 * *is* a block — so callers only offer this on genuine nested tasks.
 */
export function moveTaskToBacklog(
	index: KairosIndex,
	backlogPath: string,
	date: ISODate,
	path: string,
	owner: Block,
	task: Task,
): void {
	const assoc = task.assoc ?? owner.assoc;
	const entry: BacklogEntry = {
		// A throwaway negative line, like a day draft's (see draftLine.ts): the
		// entry has no file line until the backlog is rewritten.
		source: { path: backlogPath, line: nextDraftLine() },
		text: task.text,
		...(assoc ? { assoc } : {}),
	};
	index.returnToBacklog(
		date,
		path,
		(blocks) => deleteTask(blocks, owner, task),
		entry,
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
