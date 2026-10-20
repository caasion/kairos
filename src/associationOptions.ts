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
} from "./types";
import { effectiveStatus, projectStatusOn } from "./projectFile";

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
	const domainsById = new Map([...domains.values()].map((d) => [d.id, d]));

	for (const project of projects.values()) {
		if (project.archived) continue;
		// A project under an inactive domain is offered as inactive too.
		const domain = project.domain ? domainsById.get(project.domain) : undefined;
		options.push({
			association: { kind: "project", id: project.name },
			name: project.name,
			kind: "project",
			status: projectStatusOn(project, domain),
		});
	}

	for (const domain of domains.values()) {
		if (domain.archived) continue;
		options.push({
			association: { kind: "domain", id: domain.name },
			name: domain.name,
			kind: "domain",
			status: effectiveStatus(domain.history),
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

/** Characters a project or domain name can't contain. Brackets would end the
 *  `[Name]` tag early, `:` is reserved for `[D:Name]`, and the rest are refused
 *  in file names or links on some platform. */
const NAME_FORBIDDEN = /[[\]#^|\\/:*"<>?]/;

/**
 * Why `name` can't be a new project or domain, or null if it can. Collisions
 * are the index's to check (`nameCollision`), since they need aliases too.
 */
export function newNameProblem(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return "Type a name first.";
	if (NAME_FORBIDDEN.test(trimmed))
		return "A name can't contain [ ] # ^ | \\ / : * \" < > or ?.";
	return null;
}

/**
 * Whether the picker should offer to create `query` as a new project or
 * domain: there is something typed and no option already has that name
 * (ignoring case). An invalid name is still offered, so the picker can say
 * what's wrong with it instead of going quiet.
 */
export function offersCreate(
	options: AssociationOption[],
	query: string,
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return false;
	return !options.some((o) => o.name.toLowerCase() === q);
}
