// Grid view row model — the pure shape behind the Grid.
//
// The Grid's first-class objects are tasks and checkable blocks (spec §5),
// arranged as: rows = associations (projects and domains), columns = days,
// cells = the tasks associated with that row on that day. This module turns a
// reactive `GridSnapshot` (from the index) plus the view's expand state into a
// flat, ordered `GridRow[]`, and buckets each day's resolved tasks into cells.
//
// It is pure and vault-free so the grouping logic is unit-testable without
// Svelte or Obsidian: given the same snapshot it always yields the same rows.
//
// Row axis, in order:
//   1. project rows       — one per non-archived project NOT under a domain
//                           (projects under a domain surface inside that domain
//                           when expanded, and roll up into it when collapsed)
//   2. domain rows        — one per non-archived domain; expandable
//        · when expanded: a child row per project under the domain, then a
//          "direct" child row for tasks tagged [D:Domain] straight
//   3. unassigned row     — tasks with no owner (always last, only if non-empty)
//
// A task is matched to a row by its resolved *canonical* identity, so a daily
// note that tags an old project name (an alias) still lands in the right row.

import type { Project, ResolvedTask } from "./types";
import type { GridSnapshot } from "./index";

// ─── row types ─────────────────────────────────────────────────

/** A stable key identifying a row (used for keyed rendering and cell lookup). */
export type RowKey = string;

export type GridRow =
	| {
			kind: "project";
			key: RowKey;
			/** Canonical project name — also the association id to apply on create. */
			name: string;
			color?: string;
			/** Indent depth: 0 top-level, 1 nested under an expanded domain. */
			depth: number;
	  }
	| {
			kind: "domain";
			key: RowKey;
			name: string;
			/** The domain's stable id (for expand state + child lookup). */
			domainId: string;
			color?: string;
			expanded: boolean;
			/** Whether the domain has any expandable children (projects or tasks). */
			expandable: boolean;
			depth: 0;
	  }
	| {
			// A domain's own directly-tagged tasks, shown as a child when expanded.
			kind: "domain-direct";
			key: RowKey;
			name: string;
			domainName: string;
			color?: string;
			depth: 1;
	  }
	| { kind: "unassigned"; key: RowKey; name: string; depth: 0 };

/** The association a create-in-cell should apply for a row (undefined = none). */
export type RowAssociation =
	| { kind: "project"; id: string }
	| { kind: "domain"; id: string }
	| undefined;

// ─── canonical task identity ───────────────────────────────────

/**
 * The canonical `(kind, name)` a task belongs to, or null when unowned. Uses the
 * snapshot's resolver so an aliased tag maps to its current project/domain name;
 * an unresolved (dangling) tag falls back to its literal id so it still buckets
 * consistently.
 */
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
 * Build the ordered rows for the current snapshot and expand state. `expanded`
 * is the set of domain ids the view currently shows children for.
 */
export function buildRows(
	snap: GridSnapshot,
	expanded: ReadonlySet<string>,
): GridRow[] {
	const rows: GridRow[] = [];

	// Domain colors, by canonical name, so project rows can inherit their tint.
	const domainColorByName = new Map<string, string>();
	for (const d of snap.domains.values()) {
		if (d.color) domainColorByName.set(d.name, d.color);
	}

	// A project's tint comes from its domain (resolveAssociation does the same).
	const projectColor = (p: Project): string | undefined => {
		if (!p.domain) return undefined;
		for (const d of snap.domains.values()) {
			if (d.id === p.domain) return d.color || undefined;
		}
		return undefined;
	};

	// 1. Top-level projects (those not filed under any domain).
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

	// 2. Domains, each optionally expanded into child project rows + a direct row.
	const domains = [...snap.domains.values()]
		.filter((d) => !d.archived)
		.sort((a, b) => a.order - b.order || byName(a, b));

	for (const d of domains) {
		const children = snap.byDomainProjects.get(d.id) ?? [];
		const isExpanded = expanded.has(d.id);
		rows.push({
			kind: "domain",
			key: `domain:${d.name}`,
			name: d.name,
			domainId: d.id,
			...(d.color ? { color: d.color } : {}),
			expanded: isExpanded,
			expandable: true,
			depth: 0,
		});

		if (isExpanded) {
			for (const p of children) {
				rows.push({
					kind: "project",
					key: `project:${p.name}`,
					name: p.name,
					...(d.color ? { color: d.color } : {}),
					depth: 1,
				});
			}
			// The domain's own directly-tagged tasks.
			rows.push({
				kind: "domain-direct",
				key: `domain-direct:${d.name}`,
				name: `${d.name} (direct)`,
				domainName: d.name,
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
 * task's canonical owner identity:
 *   · project / domain-direct rows: kind + canonical name equal the row's.
 *   · a COLLAPSED domain row also absorbs its child projects' tasks (so a
 *     domain reads as a rollup until you expand it). An expanded domain row
 *     itself shows nothing — its children carry the tasks.
 *   · unassigned: tasks with no owner.
 */
export function cellTasks(
	row: GridRow,
	tasks: ResolvedTask[],
	snap: GridSnapshot,
): ResolvedTask[] {
	switch (row.kind) {
		case "unassigned":
			return tasks.filter((t) => !t.owner);

		case "domain-direct":
			return tasks.filter((t) => {
				const id = ownerIdentity(t, snap);
				return id?.kind === "domain" && id.name === row.domainName;
			});

		case "project":
			return tasks.filter((t) => {
				const id = ownerIdentity(t, snap);
				return id?.kind === "project" && id.name === row.name;
			});

		case "domain": {
			// An expanded domain delegates its tasks to child rows.
			if (row.expanded) return [];
			// Collapsed: absorb both the domain's direct tasks and every child
			// project's tasks, so the single row reads as the whole domain.
			const childNames = new Set(
				(snap.byDomainProjects.get(row.domainId) ?? []).map((p) => p.name),
			);
			return tasks.filter((t) => {
				const id = ownerIdentity(t, snap);
				if (!id) return false;
				if (id.kind === "domain" && id.name === row.name) return true;
				return id.kind === "project" && childNames.has(id.name);
			});
		}
	}
}

/** The association a create-in-cell applies for this row. */
export function rowAssociation(row: GridRow): RowAssociation {
	switch (row.kind) {
		case "project":
			return { kind: "project", id: row.name };
		case "domain":
			return { kind: "domain", id: row.name };
		case "domain-direct":
			return { kind: "domain", id: row.domainName };
		case "unassigned":
			return undefined;
	}
}
