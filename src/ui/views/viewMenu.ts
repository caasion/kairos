// The Kairos view menu (issue #17). The plugin used to add six ribbon icons, one
// per view; it now adds one, and that one opens this menu at the pointer — the
// same native menu as a right-click, so the view you want is one short move
// away rather than across a centred modal. The six commands stay in the command
// palette unchanged, so the menu is a convenience, not the only route.

import { Menu } from "obsidian";
import type Kairos from "../../main";

/** One entry of the menu: the view's icon, its name, how to open it. */
export interface KairosViewEntry {
	/** Lucide icon name — the same icon the view returns from `getIcon()`. */
	icon: string;
	/** The view's name, matching its tab title. */
	name: string;
	/** Activate the view. */
	open: () => void;
}

/**
 * The six views, in the order the ribbon used to list them. Icons are kept in
 * step with each view's own `getIcon()` so an entry and the tab it opens carry
 * the same mark.
 */
export function kairosViews(plugin: Kairos): KairosViewEntry[] {
	return [
		{ icon: "clock", name: "Day", open: () => void plugin.activateView() },
		{ icon: "calendar-range", name: "Week", open: () => void plugin.activateWeekView() },
		{ icon: "layout-grid", name: "Grid", open: () => void plugin.activateGridView() },
		{ icon: "inbox", name: "Backlog", open: () => void plugin.activateBacklogView() },
		{ icon: "folder-kanban", name: "Projects & domains", open: () => void plugin.activateProjectsView() },
		{ icon: "gantt-chart", name: "Timeline", open: () => void plugin.activateGanttView() },
	];
}

/** Open the view menu at the pointer — the ribbon icon's one job. */
export function openViewMenu(plugin: Kairos, evt: MouseEvent) {
	const menu = new Menu();
	for (const view of kairosViews(plugin)) {
		menu.addItem((item) =>
			item.setTitle(view.name).setIcon(view.icon).onClick(view.open),
		);
	}
	menu.showAtMouseEvent(evt);
}
