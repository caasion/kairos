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

import type { BacklogEntry } from "./types";
import type { Resolver } from "./index";

// ─── group types ───────────────────────────────────────────────

/** How to order entries within a group. */
export type BacklogSort = "manual" | "resurface" | "alpha";

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
