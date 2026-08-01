// Association resolution — turning a raw `[Project]` / `[D:Domain]` tag into
// something a view can render and navigate to.
//
// Pure and vault-free. The core rules (spec §2.3, §2.4, §4.4):
//   • Match by name OR alias, but always display the current canonical name, so
//     a daily-note tag written against an old name still resolves and renders
//     the new one.
//   • Color comes only from a domain — directly for a domain tag, or transitively
//     through a project's `domain_id` for a project tag.
//   • An unresolved tag (no such project/domain) is NOT an error: it renders by
//     its literal id with no color and no navigation target. This is the
//     dangling-association / unassociated case, and it must look exactly like a
//     tag did before any project files existed.

import type { Association, Domain, Project } from "./types";

/** A resolved association ready for rendering and navigation. */
export interface ResolvedAssociation {
	/** The current canonical name to display (never an alias). */
	displayName: string;
	/** Domain color, if one applies (directly or via the project's domain). */
	color?: string;
	/** The file path to open on ctrl-click, or undefined when it doesn't resolve. */
	target?: string;
	/** Whether the underlying project/domain file actually exists. */
	resolved: boolean;
}

/**
 * Look up a project/domain by exact name, falling back to an alias match. The
 * maps are keyed by canonical name, so the name hit is O(1); the alias scan is
 * the rare path (only when a tag uses an old name).
 */
function findByNameOrAlias<T extends { name: string; aliases: string[] }>(
	map: Map<string, T>,
	id: string,
): T | undefined {
	const direct = map.get(id);
	if (direct) return direct;
	for (const value of map.values()) {
		if (value.aliases.includes(id)) return value;
	}
	return undefined;
}

/** Find a domain by its stable id (used for project → domain color linking). */
function findDomainById(
	domains: Map<string, Domain>,
	id: string,
): Domain | undefined {
	for (const domain of domains.values()) {
		if (domain.id === id) return domain;
	}
	return undefined;
}

/**
 * Resolve an association against the current project/domain maps. Returns a
 * render-ready descriptor; when nothing matches, `resolved` is false and the
 * descriptor carries just the literal id (today's neutral, non-clickable look).
 */
export function resolveAssociation(
	assoc: Association,
	projects: Map<string, Project>,
	domains: Map<string, Domain>,
): ResolvedAssociation {
	if (assoc.kind === "domain") {
		const domain = findByNameOrAlias(domains, assoc.id);
		if (!domain) return { displayName: assoc.id, resolved: false };
		return {
			displayName: domain.name,
			...(domain.color ? { color: domain.color } : {}),
			target: domain.source.path,
			resolved: true,
		};
	}

	// Project tag: display the project's name, but take color from its domain.
	const project = findByNameOrAlias(projects, assoc.id);
	if (!project) return { displayName: assoc.id, resolved: false };

	// A project stores its domain by id (`domain_id`), not by name, so match on
	// id here rather than reusing the name/alias lookup.
	const color = project.domain
		? findDomainById(domains, project.domain)?.color
		: undefined;

	return {
		displayName: project.name,
		...(color ? { color } : {}),
		target: project.source.path,
		resolved: true,
	};
}
