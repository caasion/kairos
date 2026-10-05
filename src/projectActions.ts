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
	normalizeStatusShapes,
	removeStatusRecord,
	renameWithAlias,
	setColor,
	setDescription,
	setDomain,
	setOrder,
} from "./projectFile";

// ── status history (a hands-off log; editable through the guarded views) ──
//
// `set*Status` appends a change (optionally with the reason it was made);
// `edit*StatusRecord` / `remove*StatusRecord`
// revise the past. All route through the pure edit functions in projectFile.ts,
// which own the invariants (order, one-per-date, no consecutive duplicates), so
// these verbs stay thin. `note` (what the state entails) and `why` (what moved
// the entity into it) are both freeform open-label text, never logic.

export function setProjectStatus(
	index: KairosIndex,
	project: Project,
	date: ISODate,
	status: LifecycleState,
	note?: string,
	why?: string,
): void {
	index.applyProjectEdit(appendStatus(project, date, status, note, why));
}

/** Domains are durable: `archived` is refused by `appendStatus`, so the UI
 *  offers only active/inactive here. */
export function setDomainStatus(
	index: KairosIndex,
	domain: Domain,
	date: ISODate,
	status: LifecycleState,
	note?: string,
	why?: string,
): void {
	index.applyDomainEdit(appendStatus(domain, date, status, note, why));
}

/**
 * Author a *bounded* active period on the Gantt in one write: an `active` record
 * at `start` (carrying the freeform `note`) and an `inactive` record at `end`
 * that closes it. Neither record carries a `why`: a drag release is a gesture
 * with no moment to ask for a reason, and prompting on one would be exactly the
 * toll #26 rules out. A reason can still be added afterwards in the history log.
 * Composed as nested pure edits so the two records land in a
 * single entity replacement — no interleaved async writes, and `normalizeHistory`
 * still owns the invariants (order, one-per-date, consecutive-duplicate collapse).
 * `end` must be after `start`; the caller (the drag gesture) guarantees that.
 */
export function setProjectActivePeriod(
	index: KairosIndex,
	project: Project,
	start: ISODate,
	end: ISODate,
	note?: string,
): void {
	const withActive = appendStatus(project, start, "active", note);
	index.applyProjectEdit(appendStatus(withActive, end, "inactive"));
}

export function setDomainActivePeriod(
	index: KairosIndex,
	domain: Domain,
	start: ISODate,
	end: ISODate,
	note?: string,
): void {
	const withActive = appendStatus(domain, start, "active", note);
	index.applyDomainEdit(appendStatus(withActive, end, "inactive"));
}

export function editProjectStatusRecord(
	index: KairosIndex,
	project: Project,
	originalDate: ISODate,
	next: { date: ISODate; status: LifecycleState; note?: string; why?: string },
): void {
	index.applyProjectEdit(editStatusRecord(project, originalDate, next));
}

export function editDomainStatusRecord(
	index: KairosIndex,
	domain: Domain,
	originalDate: ISODate,
	next: { date: ISODate; status: LifecycleState; note?: string; why?: string },
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

// ── status normalisation (only ever on an explicit accept) ──
//
// Rewrites the `status:` entries Kairos would not have written into the form it
// does write — the flat `2026-08-04: active` scalar into the object form, a
// near-miss date key into a real record. Nothing calls these on read: the whole
// point of decision 55 is that the rewrite happens when the user says so and not
// before. Entries Kairos can't make sense of (a state outside the vocabulary)
// are left in the file untouched and keep being reported.

export function normalizeProjectStatus(
	index: KairosIndex,
	project: Project,
): void {
	const next = normalizeStatusShapes(project);
	if (next === project) return; // nothing to normalise — don't touch the file
	index.applyProjectEdit(next);
}

export function normalizeDomainStatus(index: KairosIndex, domain: Domain): void {
	const next = normalizeStatusShapes(domain);
	if (next === domain) return;
	index.applyDomainEdit(next);
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
