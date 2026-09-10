// The presentation-facing shape of a Grid/Gantt row label, plus the pure
// derivation from an entity's history. Both the Grid and the Gantt sidebar
// render row labels the same way (name + status note + tinted domain icon +
// a hover popover); this keeps that shape and its derivation in one place.

import type { Domain, ISODate, LifecycleState, Project } from "../../types";
import { effectiveRecord } from "../../projectFile";

/** Everything `RowLabel.svelte` needs to render one row's label + hover card. */
export interface RowLabelInfo {
	name: string;
	/** True for a domain row (draws the tinted domain icon on the right). */
	isDomain: boolean;
	/** The group accent color; undefined → neutral (e.g. an orphan project). */
	color?: string;
	/** The entity's free-text description (blurb) — shown in the hover card only. */
	description: string;
	/** The status in effect as of the reference day. */
	status: LifecycleState;
	/** The effective record's note — the "status description" subline; "" hides it. */
	note: string;
	/** Start of the current status span; null when the default active applies. */
	since: ISODate | null;
	/** End of the current span; null → still open ("ongoing"). */
	until: ISODate | null;
}

/**
 * Build a `RowLabelInfo` for a project/domain as of `asOf`. `color` is passed in
 * (a project inherits its domain's hue, an orphan has none), so this stays free
 * of the row-grouping concerns that own color assignment.
 */
export function rowLabelInfo(
	entity: Project | Domain,
	isDomain: boolean,
	color: string | undefined,
	asOf: ISODate,
): RowLabelInfo {
	const rec = effectiveRecord(entity.history, asOf);
	return {
		name: entity.name,
		isDomain,
		...(color ? { color } : {}),
		description: entity.description ?? "",
		status: rec.status,
		note: rec.note,
		since: rec.since,
		until: rec.until,
	};
}
