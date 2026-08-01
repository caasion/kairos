// Grid view row model — the pure shape behind the Grid.
//
// The Grid's first-class objects are tasks and checkable blocks (spec §5),
// arranged as: rows = associations (projects and domains), columns = days,
// cells = the tasks associated with that row on that day. This module turns a
// reactive `GridSnapshot` (from the index) into a flat, ordered `GridRow[]`,
// and buckets each day's resolved tasks into cells.
//
// It is pure and vault-free so the grouping logic is unit-testable without
// Svelte or Obsidian: given the same snapshot it always yields the same rows.
//
// Row axis, in order:
//   1. project rows       — one per non-archived project NOT under a domain
//   2. domain rows        — one per non-archived domain, always expanded:
//        · the domain row itself holds tasks tagged [D:Domain] directly
//        · a child row per project under the domain
//   3. unassigned row     — tasks with no owner (always last, only if non-empty)

import type { Project, ResolvedTask } from "./types";
import type { GridSnapshot } from "./index";

// ─── row types ─────────────────────────────────────────────────

/** A stable key identifying a row (used for keyed rendering and cell lookup). */
export type RowKey = string;

export type GridRow =
	| {
			kind: "project";
			key: RowKey;
			name: string;
			color?: string;
			/** Indent depth: 0 top-level, 1 child under a domain. */
			depth: number;
	  }
	| {
			kind: "domain";
			key: RowKey;
			name: string;
			domainId: string;
			color?: string;
			depth: 0;
	  }
	| { kind: "unassigned"; key: RowKey; name: string; depth: 0 };

/** The association a create-in-cell should apply for a row (undefined = none). */
export type RowAssociation =
	| { kind: "project"; id: string }
	| { kind: "domain"; id: string }
	| undefined;

// ─── canonical task identity ───────────────────────────────────

function ownerIdentity(
	task: ResolvedTask,
	snap: GridSnapshot,
): { kind: "project" | "domain"; name: string } | null {
	const owner = task.owner;
	if (!owner) return null;
	const resolved = snap.resolve(owner);
	return { kind: owner.kind, name: resolved.displayName || owner.id };
}

// ─── row assembly ──────────────────────────────────────────────

/**
 * Build the ordered rows for the current snapshot. Domains are always fully
 * expanded — every child project row is always visible.
 */
export function buildRows(snap: GridSnapshot): GridRow[] {
	const rows: GridRow[] = [];

	const projectColor = (p: Project): string | undefined => {
		if (!p.domain) return undefined;
		for (const d of snap.domains.values()) {
			if (d.id === p.domain) return d.color || undefined;
		}
		return undefined;
	};

	// 1. Top-level projects (not filed under any domain).
	const topProjects = [...snap.projects.values()]
		.filter((p) => !p.archived && !p.domain)
		.sort(byName);
	for (const p of topProjects) {
		rows.push({
			kind: "project",
			key: `project:${p.name}`,
			name: p.name,
			...(projectColor(p) ? { color: projectColor(p) } : {}),
			depth: 0,
		});
	}

	// 2. Domains — always fully expanded.
	const domains = [...snap.domains.values()]
		.filter((d) => !d.archived)
		.sort((a, b) => a.order - b.order || byName(a, b));

	for (const d of domains) {
		rows.push({
			kind: "domain",
			key: `domain:${d.name}`,
			name: d.name,
			domainId: d.id,
			...(d.color ? { color: d.color } : {}),
			depth: 0,
		});

		const children = snap.byDomainProjects.get(d.id) ?? [];
		for (const p of children) {
			rows.push({
				kind: "project",
				key: `project:${p.name}`,
				name: p.name,
				...(d.color ? { color: d.color } : {}),
				depth: 1,
			});
		}
	}

	// 3. Unassigned row, only if some day has an unowned task.
	const hasUnassigned = snap.days.some((day) =>
		day.tasks.some((t) => !t.owner),
	);
	if (hasUnassigned) {
		rows.push({
			kind: "unassigned",
			key: "unassigned",
			name: "Unassigned",
			depth: 0,
		});
	}

	return rows;
}

function byName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

// ─── cell task lookup ──────────────────────────────────────────

/**
 * The tasks belonging in a given row's cell for a given day. Matching is by the
 * task's canonical owner identity.
 */
export function cellTasks(
	row: GridRow,
	tasks: ResolvedTask[],
	snap: GridSnapshot,
): ResolvedTask[] {
	switch (row.kind) {
		case "unassigned":
			return tasks.filter((t) => !t.owner);

		case "project":
			return tasks.filter((t) => {
				const id = ownerIdentity(t, snap);
				return id?.kind === "project" && id.name === row.name;
			});

		case "domain":
			return tasks.filter((t) => {
				const id = ownerIdentity(t, snap);
				return id?.kind === "domain" && id.name === row.name;
			});
	}
}

/** The association a create-in-cell applies for this row. */
export function rowAssociation(row: GridRow): RowAssociation {
	switch (row.kind) {
		case "project":
			return { kind: "project", id: row.name };
		case "domain":
			return { kind: "domain", id: row.name };
		case "unassigned":
			return undefined;
	}
}
