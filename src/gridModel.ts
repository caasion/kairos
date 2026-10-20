// Grid view row model — the pure shape behind the Grid.
//
// The Grid's first-class objects are blocks and tasks (spec §5), arranged as:
// rows = associations (projects and domains), columns = days, cells = the
// blocks and tasks associated with that row on that day. This module turns a
// reactive `GridSnapshot` (from the index) into a flat, ordered `GridRow[]`,
// and buckets each day's resolved tasks into cells.
//
// It is pure and vault-free so the grouping logic is unit-testable without
// Svelte or Obsidian: given the same snapshot it always yields the same rows.
//
// Row axis, in order:
//   1. project rows       — one per visible project NOT under a domain
//   2. domain rows        — one per visible domain, always expanded:
//        · the domain row itself holds tasks tagged [D:Domain] directly, plus
//          the tasks of every *rolled-up* project under it (see below)
//        · a child row per project under the domain that isn't rolled up
//   3. unassigned row     — tasks and timed blocks with no owner, or an owner
//                           with no row (always present, always last), so
//                           there is always somewhere to add a loose task
//
// Rollup (#11): a project with `rollup: true` and a domain is "not worth its
// own row". It contributes no row; its tasks render on its domain's row, in a
// group under a small project header (`cellGroups`). A rolled-up project with
// no (resolvable) domain ignores the flag and keeps its own row. Which row a
// task lands on is decided in exactly one place — `ownerRowKey` — so a later
// automatic rollup (#31: a project whose row has gone away) is a condition
// there rather than a second rendering path.
//
// "Visible" is window-aware, not a today snapshot: a project/domain shows as a
// row when it was *active on any visible day* OR *carries a tagged task on any
// visible day* (spec: archiving/inactivating an entity must not erase its past
// — an archived-today project still appears for the days it was active). The
// per-day effective status then drives cell dimming (see `dayStatus`): a column
// where the entity was inactive/archived reads as read-only history.

import type {
	Association,
	Block,
	Domain,
	ISODate,
	LifecycleState,
	Project,
	ResolvedTask,
	StatusRecord,
} from "./types";
import type { GridSnapshot } from "./index";
import { effectiveRecord, effectiveStatus, projectStatusOn } from "./projectFile";
import { rowLabelInfo, type RowLabelInfo } from "./ui/components/rowLabel";

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
			/** Presentation for the row-label column + its hover card. */
			info: RowLabelInfo;
	  }
	| {
			kind: "domain";
			key: RowKey;
			name: string;
			domainId: string;
			color?: string;
			depth: 0;
			info: RowLabelInfo;
	  }
	| { kind: "unassigned"; key: RowKey; name: string; depth: 0 };

/** The association a create-in-cell should apply for a row (undefined = none). */
export type RowAssociation =
	| { kind: "project"; id: string }
	| { kind: "domain"; id: string }
	| undefined;

// ─── rollup (#11) ──────────────────────────────────────────────

function domainById(snap: GridSnapshot, id: string): Domain | undefined {
	for (const d of snap.domains.values()) if (d.id === id) return d;
	return undefined;
}

/**
 * The domain whose row a project renders on instead of its own, or undefined
 * when the project keeps its own row: the flag is off, or the project has no
 * domain to roll up into (the flag is then ignored).
 */
export function rollupDomain(
	project: Project,
	snap: GridSnapshot,
): Domain | undefined {
	if (!project.rollup || !project.domain) return undefined;
	return domainById(snap, project.domain);
}

/** The projects that render on this domain's row, by name. */
export function rolledUpProjects(domain: Domain, snap: GridSnapshot): Project[] {
	return [...snap.projects.values()]
		.filter((p) => rollupDomain(p, snap)?.id === domain.id)
		.sort(byName);
}

/**
 * The key of the row an owner's tasks render on: its own project/domain row, its
 * domain's row when the project is rolled up, or the unassigned row. A tag that
 * names no project or domain (a typo, a deleted file, `[Name]` written for a
 * domain), or a project filed under a domain that doesn't exist, has no row of
 * its own, so its tasks render on the unassigned row rather than nowhere.
 */
export function ownerRowKey(
	owner: Association | undefined,
	snap: GridSnapshot,
): RowKey {
	if (!owner) return "unassigned";
	const name = snap.resolve(owner).displayName || owner.id;
	if (owner.kind === "domain") {
		return snap.domains.has(name) ? `domain:${name}` : "unassigned";
	}
	const project = snap.projects.get(name);
	if (!project) return "unassigned";
	if (project.domain && !domainById(snap, project.domain)) return "unassigned";
	const domain = rollupDomain(project, snap);
	return domain ? `domain:${domain.name}` : `project:${name}`;
}

// ─── window-aware visibility ───────────────────────────────────

/**
 * Does any task or timed block, on any visible day, name this project/domain as
 * its owner?
 */
function hasTaskInWindow(
	entity: Project | Domain,
	kind: "project" | "domain",
	snap: GridSnapshot,
): boolean {
	const names = (owner: Association | undefined) =>
		owner?.kind === kind &&
		(snap.resolve(owner).displayName || owner.id) === entity.name;
	return snap.days.some(
		(day) =>
			day.tasks.some((t) => names(t.owner)) ||
			day.blocks.some((b) => b.time !== undefined && names(b.assoc)),
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
export function buildRows(snap: GridSnapshot, asOf: ISODate): GridRow[] {
	const rows: GridRow[] = [];

	const projectColor = (p: Project): string | undefined => {
		if (!p.domain) return undefined;
		for (const d of snap.domains.values()) {
			if (d.id === p.domain) return d.color || undefined;
		}
		return undefined;
	};

	// 1. Top-level projects (not filed under any domain) visible in the window.
	//    A rolled-up project with no domain lands here: the flag needs a domain
	//    row to roll into, so without one it is ignored.
	const topProjects = [...snap.projects.values()]
		.filter((p) => !p.domain && visibleInWindow(p, "project", snap))
		.sort(byName);
	for (const p of topProjects) {
		const color = projectColor(p);
		rows.push({
			kind: "project",
			key: `project:${p.name}`,
			name: p.name,
			...(color ? { color } : {}),
			depth: 0,
			info: rowLabelInfo(p, false, color, asOf),
		});
	}

	// 2. Domains — always fully expanded. Keep a domain if it itself is visible in
	//    the window, or any of its (visible) child projects are — so a child row
	//    never appears orphaned from its domain header.
	const domains = [...snap.domains.values()].sort(
		(a, b) => a.order - b.order || byName(a, b),
	);

	for (const d of domains) {
		// Rolled-up projects contribute no row of their own…
		const children = (snap.byDomainProjects.get(d.id) ?? []).filter(
			(p) => !rollupDomain(p, snap) && visibleInWindow(p, "project", snap),
		);
		// …but their activity in the window is the domain row's activity, so a
		// domain whose only work this window is a rolled-up project still shows.
		const rolledUpVisible = rolledUpProjects(d, snap).some((p) =>
			visibleInWindow(p, "project", snap),
		);
		if (
			!visibleInWindow(d, "domain", snap) &&
			children.length === 0 &&
			!rolledUpVisible
		) {
			continue;
		}

		const domainColor = d.color || undefined;
		// Name the rolled-up projects on the domain's label so they stay visible
		// without a row. Archived ones are left out: they've ended, and like a
		// picker the label only lists live work.
		const rolledUp = rolledUpProjects(d, snap)
			.filter((p) => !p.archived)
			.map((p) => p.name);
		const info = rowLabelInfo(d, true, domainColor, asOf);
		rows.push({
			kind: "domain",
			key: `domain:${d.name}`,
			name: d.name,
			domainId: d.id,
			...(domainColor ? { color: domainColor } : {}),
			depth: 0,
			info: rolledUp.length > 0 ? { ...info, rolledUp } : info,
		});

		for (const p of children) {
			rows.push({
				kind: "project",
				key: `project:${p.name}`,
				name: p.name,
				...(domainColor ? { color: domainColor } : {}),
				depth: 1,
				info: rowLabelInfo(p, false, domainColor, asOf),
			});
		}
	}

	// 3. Unassigned row, always: it holds tasks and timed blocks with no row of
	//    their own (untagged, or tagged with something that has no row —
	//    `ownerRowKey`), and it is where a task with no project or domain is
	//    added, so it can't wait for one to exist first.
	rows.push({
		kind: "unassigned",
		key: "unassigned",
		name: "Unassigned",
		depth: 0,
	});

	return rows;
}

function byName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

// ─── cell task lookup ──────────────────────────────────────────

/** A rolled-up project's tasks within a domain row's cell, under its header. */
export interface CellGroup {
	/** The project's canonical name — the header text. */
	name: string;
	tasks: ResolvedTask[];
}

/**
 * A cell's tasks split for rendering. `own` are the row's directly associated
 * tasks and render first, with no header. `groups` holds one entry per
 * rolled-up project with tasks in this cell, alphabetical by project name, each
 * rendered under a project header — even when it is the only group, since a
 * headerless list would read as the domain's own tasks. Only a domain row can
 * have groups.
 */
export function cellGroups(
	row: GridRow,
	tasks: ResolvedTask[],
	snap: GridSnapshot,
): { own: ResolvedTask[]; groups: CellGroup[] } {
	const mine = tasks.filter((t) => ownerRowKey(t.owner, snap) === row.key);
	if (row.kind !== "domain") return { own: mine, groups: [] };

	const own: ResolvedTask[] = [];
	const byProject = new Map<string, ResolvedTask[]>();
	for (const t of mine) {
		// On a domain row, any project-owned task is there by rollup.
		if (t.owner?.kind !== "project") {
			own.push(t);
			continue;
		}
		const name = snap.resolve(t.owner).displayName || t.owner.id;
		const list = byProject.get(name);
		if (list) list.push(t);
		else byProject.set(name, [t]);
	}
	const groups = [...byProject.entries()]
		.map(([name, list]) => ({ name, tasks: list }))
		.sort(byName);
	return { own, groups };
}

/**
 * The tasks belonging in a given row's cell for a given day, in display order
 * (a domain row's own tasks, then each rolled-up project's group). Matching is
 * by the row the task's canonical owner renders on (`ownerRowKey`).
 */
export function cellTasks(
	row: GridRow,
	tasks: ResolvedTask[],
	snap: GridSnapshot,
): ResolvedTask[] {
	const { own, groups } = cellGroups(row, tasks, snap);
	return [...own, ...groups.flatMap((g) => g.tasks)];
}

// ─── block groups (spec §5, decisions 70–74, 95) ───────────────
//
// A cell's tasks sit under the block they live in, and every timed block shows
// in its own row even with no tasks there, so the Grid says what (rows), when
// (block groups) and, on a domain row that folds in rolled-up projects, which
// project (an optional chip on the task's line).

/**
 * One block's slice of a cell: the block's tasks that render on this row. A
 * block with none here still has a group in its own row, with no tasks.
 */
export interface BlockGroup {
	/** Stable key for keyed rendering: the block's note path and line. */
	key: string;
	block: Block;
	/** The block's tasks on this row, in note order. */
	tasks: ResolvedTask[];
}

const UNSCHEDULED = "Unscheduled";

/** True for the day's Unscheduled inbox (an untimed block by that name). */
export function isUnscheduledBlock(block: Block): boolean {
	return block.time === undefined && block.title === UNSCHEDULED;
}

/**
 * A cell's blocks and tasks grouped by block: one group per block with tasks on
 * this row, plus every timed block of the day (`blocks`) whose own association
 * renders on this row, tasks or not. Timed blocks by start time, then other
 * untimed blocks, then Unscheduled last. A block whose tasks carry different
 * associations also appears in each of those rows (decision 73): there the
 * header is a label, not ownership.
 */
/** A task's or block's place in its note, "path:line": unique across days. */
export function sourceKey(source: { path: string; line: number }): string {
	return `${source.path}:${source.line}`;
}

export function blockGroups(
	row: GridRow,
	tasks: ResolvedTask[],
	snap: GridSnapshot,
	blocks: Block[] = [],
): BlockGroup[] {
	const groups = new Map<string, BlockGroup>();
	for (const t of tasks) {
		if (ownerRowKey(t.owner, snap) !== row.key) continue;
		const key = sourceKey(t.block.source);
		let group = groups.get(key);
		if (!group) {
			group = { key, block: t.block, tasks: [] };
			groups.set(key, group);
		}
		group.tasks.push(t);
	}
	// A block is time spent on its own row's area, so it shows there even when
	// none of its tasks do (decision 95).
	for (const b of blocks) {
		if (!b.time || ownerRowKey(b.assoc, snap) !== row.key) continue;
		const key = sourceKey(b.source);
		if (!groups.has(key)) groups.set(key, { key, block: b, tasks: [] });
	}
	return [...groups.values()].sort((a, b) => blockRank(a.block) - blockRank(b.block) || byTime(a.block, b.block));
}

// Timed blocks first, then other untimed blocks, then Unscheduled.
function blockRank(block: Block): number {
	if (block.time) return 0;
	return isUnscheduledBlock(block) ? 2 : 1;
}

function byTime(a: Block, b: Block): number {
	if (a.time && b.time) {
		return a.time.start - b.time.start || a.time.end - b.time.end || a.title.localeCompare(b.title);
	}
	return 0; // untimed blocks keep their note order (the sort is stable)
}

/**
 * The project a task on a domain row is there for by rollup (#11), for the
 * optional chip at the end of its line. Undefined on other rows, and for the
 * domain's own tasks.
 */
export function rolledUpProjectOf(
	row: GridRow,
	task: ResolvedTask,
	snap: GridSnapshot,
): string | undefined {
	if (row.kind !== "domain" || task.owner?.kind !== "project") return undefined;
	return snap.resolve(task.owner).displayName || task.owner.id;
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
	if (row.kind === "domain") {
		const domain = snap.domains.get(row.name);
		return domain ? effectiveStatus(domain.history, date) : "active";
	}
	// A project row is also bounded by its domain: an inactive domain makes its
	// whole subtree read-only for that day (`projectStatusOn`).
	const project = snap.projects.get(row.name);
	if (!project) return "active";
	const domain = project.domain ? domainById(snap, project.domain) : undefined;
	return projectStatusOn(project, domain, date);
}

/** The row entity's own status history; undefined for the unassigned row. */
function rowHistory(row: GridRow, snap: GridSnapshot): StatusRecord[] | undefined {
	if (row.kind === "unassigned") return undefined;
	const entity =
		row.kind === "domain" ? snap.domains.get(row.name) : snap.projects.get(row.name);
	return entity?.history;
}

/**
 * The row's 0–5 intensity on a given day: the level on the entity's own record
 * in effect that day, or null when that record isn't active or carries none.
 * A project's intensity is its own; its domain's doesn't bleed into it.
 */
export function intensityOn(
	row: GridRow,
	date: ISODate,
	snap: GridSnapshot,
): number | null {
	const history = rowHistory(row, snap);
	if (!history) return null;
	const rec = effectiveRecord(history, date);
	return rec.status === "active" ? rec.intensity : null;
}

/**
 * The intensity change a record dated exactly `date` makes, or null when no
 * record starts that day or the level doesn't move. The Grid labels each row
 * with its intensity on the first visible day and marks these changes in the
 * cells after it. Going to no level (inactive, or unrated) isn't a change worth
 * marking: an inactive day is already dimmed.
 */
export function intensityChange(
	row: GridRow,
	date: ISODate,
	snap: GridSnapshot,
): { from: number | null; to: number } | null {
	const history = rowHistory(row, snap);
	if (!history?.some((r) => r.date === date)) return null;
	const to = intensityOn(row, date, snap);
	if (to === null) return null;
	const prev = history.filter((r) => r.date < date).at(-1);
	const from = prev?.status === "active" ? (prev.intensity ?? null) : null;
	return from === to ? null : { from, to };
}

/**
 * The new intention a record dated exactly `date` sets, or null when no record
 * starts that day, it keeps the previous record's note, or it has none. The
 * Grid's label shows today's intention (prose doesn't fit a starting-point
 * glyph the way five pips do), so a change anywhere in the window is marked in
 * its cell instead. Like intensity, clearing the intention isn't marked.
 */
export function intentionChange(
	row: GridRow,
	date: ISODate,
	snap: GridSnapshot,
): string | null {
	const history = rowHistory(row, snap);
	const rec = history?.find((r) => r.date === date);
	if (!history || !rec?.note) return null;
	const prev = history.filter((r) => r.date < date).at(-1);
	return prev?.note === rec.note ? null : rec.note;
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

/**
 * What a drag-drop onto `target` writes for an item whose effective owner is
 * `owner`, or undefined when there is no target row (preserve everything).
 *
 *   • A drop on a *different* row re-files the item to that row's association
 *     (a domain row assigns the domain; the unassigned row clears it → null).
 *   • A drop on the row the item already renders on keeps its own association
 *     (`sameRow`). On a rolled-up domain row (#11) that row holds several
 *     projects' tasks, and its row association is the domain: rescheduling a
 *     Groceries task to another day in the Life row must not silently turn it
 *     into a Life task. Same day + same row is therefore a no-op for the caller.
 */
export function dropAssociation(
	target: GridRow | undefined,
	owner: Association | undefined,
	snap: GridSnapshot,
): { assoc: Association | null; sameRow: boolean } | undefined {
	if (!target) return undefined;
	if (ownerRowKey(owner, snap) === target.key) {
		return { assoc: owner ? { ...owner } : null, sameRow: true };
	}
	const assoc = rowAssociation(target);
	return { assoc: assoc ? { kind: assoc.kind, id: assoc.id } : null, sameRow: false };
}

/**
 * `dropAssociation` for a block dragged by a header on row `fromRowKey`. A
 * block's header also shows, as a label, in each row one of its tasks belongs
 * to (decision 73). Dropping it back on the row it was lifted from keeps its
 * own association, as on its own row: the label row is the task's, and filing
 * the whole block there would take every task inheriting its area with it.
 */
export function blockDropAssociation(
	target: GridRow | undefined,
	fromRowKey: string | undefined,
	owner: Association | undefined,
	snap: GridSnapshot,
): { assoc: Association | null; sameRow: boolean } | undefined {
	if (target && fromRowKey !== undefined && target.key === fromRowKey) {
		return { assoc: owner ? { ...owner } : null, sameRow: true };
	}
	return dropAssociation(target, owner, snap);
}
