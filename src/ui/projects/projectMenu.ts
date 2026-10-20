// Project menu items shared by the Projects page and the Grid's row labels, so
// the two menus stay identical: "Change domain" (a submenu of every domain plus
// "None") and the Grid rollup toggle (#11). Writes go through projectActions →
// the index, exactly like every other project edit.

import type { Menu, MenuItem } from "obsidian";
import type { KairosIndex } from "../../index";
import { setProjectDomain, setProjectRollup } from "../../projectActions";
import type { Domain, Project } from "../../types";

/**
 * A menu item's submenu. `setSubmenu` exists on Obsidian's MenuItem at runtime
 * but isn't in the published typings, so it's typed here once.
 */
export function submenuOf(item: MenuItem): Menu {
	return (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();
}

/** Domains in page order (the user's `order`, then name). */
function ordered(domains: Iterable<Domain>): Domain[] {
	return [...domains].sort(
		(a, b) =>
			a.order - b.order ||
			a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
	);
}

/**
 * Add "Change domain" to `menu`: a submenu listing every domain plus "None" to
 * clear, with the current one checked. The project stores the domain's stable
 * id; picking the current domain is a no-op.
 */
export function addChangeDomainItem(
	menu: Menu,
	index: KairosIndex,
	project: Project,
	domains: Iterable<Domain>,
): void {
	const pick = (domainId: string | undefined) => {
		if (project.domain === domainId) return;
		setProjectDomain(index, project, domainId);
	};
	menu.addItem((item) => {
		item.setTitle("Change domain").setIcon("panel-top");
		const submenu = submenuOf(item);
		submenu.addItem((sub) =>
			sub
				.setTitle("None")
				.setChecked(!project.domain)
				.onClick(() => pick(undefined)),
		);
		for (const d of ordered(domains)) {
			submenu.addItem((sub) =>
				sub
					.setTitle(d.name)
					.setChecked(project.domain === d.id)
					.onClick(() => pick(d.id)),
			);
		}
	});
}

/**
 * Add the rollup toggle — "Show on domain's row" / "Give its own row" — for a
 * project that has a domain to roll up into. A no-op for a domain-less project,
 * where the flag would mean nothing.
 */
export function addRollupItem(
	menu: Menu,
	index: KairosIndex,
	project: Project,
): void {
	if (!project.domain) return;
	menu.addItem((item) =>
		item
			.setTitle(project.rollup ? "Give its own row" : "Show on domain's row")
			.setIcon(project.rollup ? "unfold-vertical" : "fold-vertical")
			.onClick(() => setProjectRollup(index, project, !project.rollup)),
	);
}
