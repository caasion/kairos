// Building the list of pickable associations for the association popup.
//
// Pure and vault-free. Given the index's project/domain maps, produce the
// entries a combo box offers: every non-archived project and domain, tagged
// with its current lifecycle state so the UI can group/sort active before
// inactive. Archived items are omitted (spec §4.4: archived vanishes from
// pickers but stays resolvable for history).

import type {
	Association,
	Domain,
	LifecycleState,
	Project,
	StatusRecord,
} from "./types";

/** One selectable row in the association picker. */
export interface AssociationOption {
	/** The association this row would apply. */
	association: Association;
	/** Canonical display name. */
	name: string;
	kind: "project" | "domain";
	/** Current lifecycle state (latest status record; defaults to active). */
	status: LifecycleState;
}

/** The latest status in a history, or "active" when none is recorded. */
function currentStatus(history: StatusRecord[]): LifecycleState {
	return history.at(-1)?.status ?? "active";
}

/**
 * Assemble picker options from the project/domain maps. Archived entries are
 * dropped. Sort: active before inactive, then alphabetical by name; projects
 * and domains interleave by that order (the UI can still group by `kind`).
 */
export function associationOptions(
	projects: Map<string, Project>,
	domains: Map<string, Domain>,
): AssociationOption[] {
	const options: AssociationOption[] = [];

	for (const project of projects.values()) {
		if (project.archived) continue;
		options.push({
			association: { kind: "project", id: project.name },
			name: project.name,
			kind: "project",
			status: currentStatus(project.history),
		});
	}

	for (const domain of domains.values()) {
		if (domain.archived) continue;
		options.push({
			association: { kind: "domain", id: domain.name },
			name: domain.name,
			kind: "domain",
			status: currentStatus(domain.history),
		});
	}

	return options.sort(compareOptions);
}

// Active first, then inactive; ties broken alphabetically (case-insensitive).
function compareOptions(a: AssociationOption, b: AssociationOption): number {
	const rank = (o: AssociationOption) => (o.status === "active" ? 0 : 1);
	const byStatus = rank(a) - rank(b);
	if (byStatus !== 0) return byStatus;
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Filter options by a search query against name (case-insensitive substring).
 * An empty query returns everything.
 */
export function filterOptions(
	options: AssociationOption[],
	query: string,
): AssociationOption[] {
	const q = query.trim().toLowerCase();
	if (!q) return options;
	return options.filter((o) => o.name.toLowerCase().includes(q));
}
