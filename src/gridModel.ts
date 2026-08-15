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
//   1. project rows       — one per visible project NOT under a domain
//   2. domain rows        — one per visible domain, always expanded:
//        · the domain row itself holds tasks tagged [D:Domain] directly
//        · a child row per project under the domain
//   3. unassigned row     — tasks with no owner (always last, only if non-empty)
//
// "Visible" is window-aware, not a today snapshot: a project/domain shows as a
// row when it was *active on any visible day* OR *carries a tagged task on any
// visible day* (spec: archiving/inactivating an entity must not erase its past
// — an archived-today project still appears for the days it was active). The
// per-day effective status then drives cell dimming (see `dayStatus`): a column
// where the entity was inactive/archived reads as read-only history.

import type {
	Domain,
	ISODate,
	LifecycleState,
	Project,
	ResolvedTask,
} from "./types";
import type { GridSnapshot } from "./index";
import { effectiveStatus } from "./projectFile";

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

// ─── window-aware visibility ───────────────────────────────────

/** Does any task, on any visible day, name this project/domain as its owner? */
function hasTaskInWindow(
	entity: Project | Domain,
	kind: "project" | "domain",
	snap: GridSnapshot,
): boolean {
	return snap.days.some((day) =>
		day.tasks.some((t) => {
			const id = ownerIdentity(t, snap);
			return id?.kind === kind && id.name === entity.name;
		}),
	);
}

/** Was the entity active (its effective status) on any visible day? */
function activeOnAnyVisibleDay(
	entity: Project | Domain,
	snap: GridSnapshot,
): boolean {
	return snap.days.some(
		(day) => effectiveStatus(entity.history, day.date) === "active",
	);
}

/**
 * Whether a project/domain earns a row for the current window: it was active on
 * a visible day, or it carried a tagged task on a visible day. An entity that is
 * archived/inactive *today* but was active (or worked) within the window still
 * shows, so its history isn't hidden.
 */
function visibleInWindow(
	entity: Project | Domain,
	kind: "project" | "domain",
	snap: GridSnapshot,
): boolean {
	return (
		activeOnAnyVisibleDay(entity, snap) || hasTaskInWindow(entity, kind, snap)
	);
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

	// 1. Top-level projects (not filed under any domain) visible in the window.
	const topProjects = [...snap.projects.values()]
		.filter((p) => !p.domain && visibleInWindow(p, "project", snap))
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

	// 2. Domains — always fully expanded. Keep a domain if it itself is visible in
	//    the window, or any of its (visible) child projects are — so a child row
	//    never appears orphaned from its domain header.
	const domains = [...snap.domains.values()].sort(
		(a, b) => a.order - b.order || byName(a, b),
	);

	for (const d of domains) {
		const children = (snap.byDomainProjects.get(d.id) ?? []).filter((p) =>
			visibleInWindow(p, "project", snap),
		);
		if (!visibleInWindow(d, "domain", snap) && children.length === 0) continue;

		rows.push({
			kind: "domain",
			key: `domain:${d.name}`,
			name: d.name,
			domainId: d.id,
			...(d.color ? { color: d.color } : {}),
			depth: 0,
		});

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

/**
 * The row entity's effective lifecycle status on a given day. Used to dim and
 * lock a cell for days when the project/domain was inactive/archived — the row
 * is present for its history, but those columns are read-only. The unassigned
 * row is a virtual bucket with no lifecycle, so it always reads active.
 */
export function dayStatus(
	row: GridRow,
	date: ISODate,
	snap: GridSnapshot,
): LifecycleState {
	if (row.kind === "unassigned") return "active";
	const entity =
		row.kind === "domain"
			? snap.domains.get(row.name)
			: snap.projects.get(row.name);
	if (!entity) return "active";
	return effectiveStatus(entity.history, date);
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
