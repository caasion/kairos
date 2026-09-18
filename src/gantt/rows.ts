// Timeline row selection — which projects/domains earn a row in the viewport.
//
// Archiving must never erase the past: the rule is the Grid's window-aware one
// (gridModel's `visibleInWindow`), not a flat "hide archived". An archived
// entity keeps its row for a window it has something to show in, and only
// vanishes once the window moves past its history. The window here is the
// Timeline's own viewport — the whole calendar unit `getUnitViewport` hands
// back — not the Grid's day columns.
//
// "Something to show" is narrower than in the Grid, because the Timeline's only
// content is its active spans: inactivity is the absence of a bar, and the plot
// draws nothing at all for an inactive/archived stretch. So an archived entity
// earns a row when it was *active on some day of the viewport*. The Grid's
// second limb — "a task in the window is still tagged to it" — has no analogue:
// the Timeline feed (ProjectsDomains) carries no tasks.
//
// Non-archived entities always keep a row, which is where this parts company
// with the Grid. The Timeline is also the authoring surface: a new active period
// is drawn on the empty space of a row (see GanttView's pointer model), so an
// entity that is merely paused must stay reachable — otherwise a project could
// never be restarted, or scheduled into a future month, from this view.
//
// Pure and vault-free, like the rest of src/gantt, so it runs under vitest.

import type { Domain, ISODate, Project, StatusRecord } from "../types";
import type { ProjectsDomains } from "../index";
import { effectiveStatus } from "../projectFile";

/**
 * Was the entity active on any day in `[start, end]` (inclusive)?
 *
 * Read off the history rather than day-by-day: the status in effect on the
 * window's first day, plus any `active` record landing inside the window after
 * it. Between them those cover every day of the window — a day's status only
 * changes where a record opens it — and the cost stays O(records) whether the
 * viewport is a week or a year.
 *
 * An empty history reads as active (effectiveStatus's default: nothing recorded
 * yet is not the same as inactive), so a fresh project still draws.
 */
export function activeInWindow(
	history: StatusRecord[],
	start: ISODate,
	end: ISODate,
): boolean {
	if (effectiveStatus(history, start) === "active") return true;
	return history.some(
		(r) => r.status === "active" && r.date > start && r.date <= end,
	);
}

/**
 * Whether an entity earns a row for the viewport `[start, end]`: always, unless
 * it is archived as of `today`, in which case only when the viewport still shows
 * a stretch it was active for. Status is taken as of `today` rather than from
 * the parsed `archived` flag so a future-dated archive record doesn't hide the
 * row before its date arrives (the same reading the Projects page uses).
 */
export function earnsRow(
	history: StatusRecord[],
	start: ISODate,
	end: ISODate,
	today: ISODate,
): boolean {
	if (effectiveStatus(history, today) !== "archived") return true;
	return activeInWindow(history, start, end);
}

/** The feed, filtered to the rows worth drawing for the current viewport. */
export interface VisibleEntities {
	/** Domains that earn a header, each with its visible child projects. */
	domains: { domain: Domain; projects: Project[] }[];
	/** Visible projects filed under no domain. */
	orphans: Project[];
}

/**
 * Filter a `ProjectsDomains` feed down to the entities visible in the viewport.
 * Order is preserved — the feed already sorts domains by `order` and projects by
 * name, and the Timeline renders in feed order.
 *
 * A domain is kept when it earns a row itself *or* any of its children do, so a
 * child row is never orphaned from its header (the same guard the Grid and the
 * Projects page apply).
 */
export function visibleEntities(
	feed: ProjectsDomains,
	start: ISODate,
	end: ISODate,
	today: ISODate,
): VisibleEntities {
	const domains: VisibleEntities["domains"] = [];
	for (const domain of feed.domains) {
		const projects = (feed.projectsByDomain.get(domain.id) ?? []).filter((p) =>
			earnsRow(p.history, start, end, today),
		);
		if (!earnsRow(domain.history, start, end, today) && projects.length === 0) {
			continue;
		}
		domains.push({ domain, projects });
	}
	return {
		domains,
		orphans: feed.orphans.filter((p) => earnsRow(p.history, start, end, today)),
	};
}
