// A routine is only active while its owner is (decision 87).
//
// A routine tagged with a project or domain is offered only on days that owner's
// effective status is active — the same status history that dims the Grid's
// cells (`dayStatus`), with a project bounded by its domain (`projectStatusOn`).
// Ending a season (making the project inactive) pauses its routines from that
// date without editing them; reactivating it brings them back. An untagged
// routine (Lunch, Sleep) is always active, and so is one whose tag names no
// project or domain: dropping it silently would hide a typo.
//
// This only decides what is offered. Lines already in a day stay; and since the
// routines hash covers the active routines, a status change that alters a day's
// due set makes the hash differ, so a set-up day offers what's newly due.
// Pure: no Obsidian imports.

import { resolveAssociation } from "../association";
import { effectiveStatus, projectStatusOn } from "../projectFile";
import type { Association, Domain, ISODate, Project } from "../types";
import { routineAssoc } from "./apply";
import type { Routine } from "./routinesFile";

/** Whether an owner is active on a date. */
export type OwnerActive = (assoc: Association, date: ISODate) => boolean;

/** Build an `OwnerActive` from the index's project and domain maps (keyed by name). */
export function ownerActive(
	projects: Map<string, Project>,
	domains: Map<string, Domain>,
): OwnerActive {
	return (assoc, date) => {
		const name = resolveAssociation(assoc, projects, domains).displayName || assoc.id;
		if (assoc.kind === "domain") {
			const domain = domains.get(name);
			return !domain || effectiveStatus(domain.history, date) === "active";
		}
		const project = projects.get(name);
		if (!project) return true;
		const domain = project.domain
			? [...domains.values()].find((d) => d.id === project.domain)
			: undefined;
		return projectStatusOn(project, domain, date) === "active";
	};
}

/** `routines` without those whose owner isn't active on `date`. All of them without `active`. */
export function activeRoutines(
	routines: Routine[],
	date: ISODate,
	active?: OwnerActive,
): Routine[] {
	if (!active) return routines;
	return routines.filter((r) => {
		const assoc = routineAssoc(r);
		return !assoc || active(assoc, date);
	});
}
