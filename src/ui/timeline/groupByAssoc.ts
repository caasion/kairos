// PROTOTYPE: groups a Day view list (Unscheduled, "Left from", Resurfacing)
// under one header per project or domain, the way the Grid groups its rows,
// so a row no longer repeats its association on a line of its own.

import type { Association } from "../../types";
import type { ResolvedAssociation } from "../../association";

export interface AssocGroup<T> {
	/** Stable key: the resolved note path, else kind + raw id; "" for none. */
	key: string;
	/** Undefined for the trailing group of items with no association. */
	assoc?: Association;
	resolved?: ResolvedAssociation;
	items: T[];
}

/**
 * Groups `items` by association, in the order each association first appears,
 * with unassociated items last. Two ids that resolve to the same note (an
 * alias and the canonical name) share a group.
 */
export function groupByAssoc<T>(
	items: readonly T[],
	assocOf: (item: T) => Association | undefined,
	resolve: (assoc: Association) => ResolvedAssociation,
): AssocGroup<T>[] {
	const groups = new Map<string, AssocGroup<T>>();
	const none: T[] = [];
	for (const item of items) {
		const assoc = assocOf(item);
		if (!assoc) {
			none.push(item);
			continue;
		}
		const resolved = resolve(assoc);
		const key = resolved.target ?? `${assoc.kind}:${assoc.id}`;
		let group = groups.get(key);
		if (!group) {
			group = { key, assoc, resolved, items: [] };
			groups.set(key, group);
		}
		group.items.push(item);
	}
	const out = [...groups.values()];
	if (none.length > 0) out.push({ key: "", items: none });
	return out;
}
