// Project & domain page actions — the thin write verbs the page calls.
//
// Mirrors backlogActions.ts: no state, no markdown, no UI. Each verb takes the
// current entity (as the page rendered it), applies a pure edit from
// projectFile.ts, and routes the result through the index's write path. The page
// never touches projectFile or the index's frontmatter serialization directly —
// it calls these, exactly as the backlog view calls backlogActions.
//
// Renames are async (a file move); everything else is a fire-and-forget metadata
// edit. Rename and create are gated by `nameCollision` (spec §4.4 conflict guard)
// — the caller checks first and surfaces the clash to the user.

import type { Domain, ISODate, LifecycleState, Project } from "./types";
import type { KairosIndex } from "./index";
import {
	appendStatus,
	editStatusRecord,
	removeStatusRecord,
	renameWithAlias,
	setColor,
	setDescription,
	setDomain,
	setOrder,
} from "./projectFile";

// ── status history (a hands-off log; editable through the guarded views) ──
//
// `set*Status` appends a change; `edit*StatusRecord` / `remove*StatusRecord`
// revise the past. All route through the pure edit functions in projectFile.ts,
// which own the invariants (order, one-per-date, no consecutive duplicates), so
// these verbs stay thin. `note` is a freeform open-label annotation (never logic).

export function setProjectStatus(
	index: KairosIndex,
	project: Project,
	date: ISODate,
	status: LifecycleState,
	note?: string,
): void {
	index.applyProjectEdit(appendStatus(project, date, status, note));
}

/** Domains are durable: `archived` is refused by `appendStatus`, so the UI
 *  offers only active/inactive here. */
export function setDomainStatus(
	index: KairosIndex,
	domain: Domain,
	date: ISODate,
	status: LifecycleState,
	note?: string,
): void {
	index.applyDomainEdit(appendStatus(domain, date, status, note));
}

export function editProjectStatusRecord(
	index: KairosIndex,
	project: Project,
	originalDate: ISODate,
	next: { date: ISODate; status: LifecycleState; note?: string },
): void {
	index.applyProjectEdit(editStatusRecord(project, originalDate, next));
}

export function editDomainStatusRecord(
	index: KairosIndex,
	domain: Domain,
	originalDate: ISODate,
	next: { date: ISODate; status: LifecycleState; note?: string },
): void {
	index.applyDomainEdit(editStatusRecord(domain, originalDate, next));
}

export function removeProjectStatusRecord(
	index: KairosIndex,
	project: Project,
	date: ISODate,
): void {
	index.applyProjectEdit(removeStatusRecord(project, date));
}

export function removeDomainStatusRecord(
	index: KairosIndex,
	domain: Domain,
	date: ISODate,
): void {
	index.applyDomainEdit(removeStatusRecord(domain, date));
}

// ── description (either kind) ──

export function setProjectDescription(
	index: KairosIndex,
	project: Project,
	description: string,
): void {
	index.applyProjectEdit(setDescription(project, description));
}

export function setDomainDescription(
	index: KairosIndex,
	domain: Domain,
	description: string,
): void {
	index.applyDomainEdit(setDescription(domain, description));
}

// ── domain-only metadata ──

export function setDomainColor(
	index: KairosIndex,
	domain: Domain,
	color: string,
): void {
	index.applyDomainEdit(setColor(domain, color));
}

export function setDomainOrder(
	index: KairosIndex,
	domain: Domain,
	order: number,
): void {
	index.applyDomainEdit(setOrder(domain, order));
}

// ── project → domain link ──

export function setProjectDomain(
	index: KairosIndex,
	project: Project,
	domainId: string | undefined,
): void {
	index.applyProjectEdit(setDomain(project, domainId));
}

// ── rename (async file move; caller must clear the guard first) ──

export async function renameProject(
	index: KairosIndex,
	project: Project,
	newName: string,
): Promise<void> {
	const renamed = renameWithAlias(project, newName);
	if (renamed === project) return; // no-op (same name / empty)
	await index.renameProject(project.name, renamed);
}

export async function renameDomain(
	index: KairosIndex,
	domain: Domain,
	newName: string,
): Promise<void> {
	const renamed = renameWithAlias(domain, newName);
	if (renamed === domain) return;
	await index.renameDomain(domain.name, renamed);
}
