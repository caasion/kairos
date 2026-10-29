// Today's leftovers (carry.ts) as a store, for the views that show
// an Inbox without owning a single day the way the Day view does: the Week
// strip and the Grid put them in today's column. Same rule as the Day view:
// the open tasks on the most recent earlier note, until "Leave the rest"
// marks today's note.

import { derived, type Readable } from "svelte/store";
import { leftovers, type Leftover } from "../../carry";
import { dateFromISO, shiftISO, todayISO } from "../../dayNote";
import type { KairosIndex } from "../../index";
import type { LeftoverActions } from "../../routines/routinesFeed";
import type { Day, ISODate } from "../../types";

export interface TodayLeftovers {
	today: ISODate;
	from: Day;
	items: Leftover[];
}

export function todayLeftovers(
	index: KairosIndex,
	actions: LeftoverActions,
): Readable<TodayLeftovers | undefined> {
	const today = todayISO();
	return derived(
		[index.day(today), index.dayBefore(today), actions.carried$],
		([day, before, carried]) => {
			if (!before || carried(today) !== undefined) return undefined;
			const items = leftovers(before.blocks, day?.blocks ?? []);
			return items.length > 0 ? { today, from: before, items } : undefined;
		},
	);
}

/**
 * The heading over a list of leftovers. They come from the most recent earlier
 * note, which is usually yesterday's, so that day goes unsaid; after a gap (a
 * weekend, a day with no note) it names the day: "Left open on Fri".
 */
export function leftOpenLabel(from: ISODate, today: ISODate): string {
	if (from === shiftISO(today, -1)) return "Left open";
	const weekday = dateFromISO(from).toLocaleDateString(undefined, { weekday: "short" });
	return `Left open on ${weekday}`;
}
