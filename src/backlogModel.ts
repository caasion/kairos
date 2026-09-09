// Backlog view model — the pure shape behind the Backlog view.
//
// The Backlog view is a flat list grouped by association (spec §5): one group
// per project/domain an entry points at, plus an explicit "Unassociated" group
// for entries with no tag (a first-class bucket, not overflow — spec §2.3). This
// module turns the index's flat `BacklogEntry[]` into ordered `BacklogGroup[]`,
// and offers a sort within each group.
//
// Pure and vault-free (mirrors gridModel.ts): given the same entries + resolver
// it always yields the same groups, so the grouping/sorting is unit-testable
// without Svelte or Obsidian.

import type { BacklogEntry, ISODate } from "./types";
import type { Resolver } from "./index";

// ─── group types ───────────────────────────────────────────────

/** How to order entries within a group. */
export type BacklogSort = "manual" | "resurface" | "alpha";

/**
 * Which entries to show. A backlog entry's only form of scheduling is its
 * resurface date — the day it comes back to ask to be done — so "scheduled"
 * means it carries one and "unscheduled" means it doesn't.
 */
export type BacklogSchedule = "all" | "scheduled" | "unscheduled";

export interface BacklogGroup {
	/** Stable key for keyed rendering: `project:Name`, `domain:Name`, or `none`. */
	key: string;
	/** Display name — the current canonical name, or "Unassociated". */
	name: string;
	/** Group kind, for the row accent / icon. */
	kind: "project" | "domain" | "none";
	/** Domain color, if one applies (via resolver). Absent for Unassociated. */
	color?: string;
	/** The entries in this group, ordered per the active sort. */
	entries: BacklogEntry[];
}

// ─── schedule filter ───────────────────────────────────────────

/**
 * Narrow entries to those that are (or aren't) waiting on a resurface date.
 * Applied before grouping, so the groups reflect only what's shown — an empty
 * group simply doesn't appear, except Unassociated, which always does.
 */
export function filterBySchedule(
	entries: BacklogEntry[],
	schedule: BacklogSchedule,
): BacklogEntry[] {
	switch (schedule) {
		case "all":
			return entries;
		case "scheduled":
			return entries.filter((e) => e.resurface !== undefined);
		case "unscheduled":
			return entries.filter((e) => e.resurface === undefined);
	}
}

// ─── grouping ──────────────────────────────────────────────────

/**
 * Group entries by their association, resolved to a canonical name so entries
 * tagged with an old alias land in the same group as the current name. Groups
 * are ordered: projects (alpha), then domains (alpha), then Unassociated last —
 * and Unassociated is always present (an empty backlog still shows where a new,
 * untagged entry will go). Within each group, entries are sorted by `sort`.
 */
export function groupBacklog(
	entries: BacklogEntry[],
	resolve: Resolver,
	sort: BacklogSort = "manual",
): BacklogGroup[] {
	const projects = new Map<string, BacklogGroup>();
	const domains = new Map<string, BacklogGroup>();
	const none: BacklogEntry[] = [];

	for (const entry of entries) {
		if (!entry.assoc) {
			none.push(entry);
			continue;
		}
		const resolved = resolve(entry.assoc);
		const name = resolved.displayName || entry.assoc.id;
		const bucket = entry.assoc.kind === "project" ? projects : domains;
		const key = `${entry.assoc.kind}:${name}`;
		let group = bucket.get(key);
		if (!group) {
			group = {
				key,
				name,
				kind: entry.assoc.kind,
				...(resolved.color ? { color: resolved.color } : {}),
				entries: [],
			};
			bucket.set(key, group);
		}
		group.entries.push(entry);
	}

	const byName = (a: BacklogGroup, b: BacklogGroup) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

	const ordered = [
		...[...projects.values()].sort(byName),
		...[...domains.values()].sort(byName),
	];
	for (const group of ordered) group.entries = sortEntries(group.entries, sort);

	// Unassociated is always last and always present.
	ordered.push({
		key: "none",
		name: "Unassociated",
		kind: "none",
		entries: sortEntries(none, sort),
	});

	return ordered;
}

/**
 * Sort a group's entries. `manual` preserves file order (source line). `alpha`
 * sorts by text. `resurface` sorts by resurface date ascending, with entries
 * that carry no date last (they're not waiting on anything).
 */
export function sortEntries(
	entries: BacklogEntry[],
	sort: BacklogSort,
): BacklogEntry[] {
	const copy = [...entries];
	switch (sort) {
		case "manual":
			return copy.sort((a, b) => a.source.line - b.source.line);
		case "alpha":
			return copy.sort((a, b) =>
				a.text.localeCompare(b.text, undefined, { sensitivity: "base" }),
			);
		case "resurface":
			return copy.sort((a, b) => {
				if (a.resurface && b.resurface) {
					return a.resurface < b.resurface ? -1 : a.resurface > b.resurface ? 1 : 0;
				}
				if (a.resurface) return -1;
				if (b.resurface) return 1;
				return a.source.line - b.source.line;
			});
	}
}

// ─── resurfacing (nudges in the day / grid) ─────────────────────
//
// A backlog entry with a resurface date "surfaces" as a nudge on exactly one
// day: `max(resurface, today)`. An overdue entry (resurface in the past)
// collapses onto today rather than smearing across every intervening day, and a
// future entry surfaces on its resurface date. Entries with no resurface date
// never surface. Surfacing is display-only — the entry stays in the backlog file
// until the user inserts it (scheduleEntry), at which point it becomes a real
// day task. All pure, so the day/grid views share one selector.

/**
 * The single day an entry surfaces on, or null if it carries no resurface date.
 * `max(resurface, today)`: overdue entries surface today; future ones on their
 * date. Both args are ISO `YYYY-MM-DD`, which compare correctly as strings.
 */
export function surfaceDate(
	entry: BacklogEntry,
	today: ISODate,
): ISODate | null {
	if (!entry.resurface) return null;
	return entry.resurface > today ? entry.resurface : today;
}

/**
 * The entries that surface on `date` given the current `today`. This is the one
 * selector the Day and Grid views call to render nudges for a given day cell.
 * Ordered by resurface date (oldest intent first), then file order.
 */
export function surfacedOn(
	entries: BacklogEntry[],
	date: ISODate,
	today: ISODate,
): BacklogEntry[] {
	return entries
		.filter((e) => surfaceDate(e, today) === date)
		.sort(
			(a, b) =>
				(a.resurface ?? "").localeCompare(b.resurface ?? "") ||
				a.source.line - b.source.line,
		);
}

