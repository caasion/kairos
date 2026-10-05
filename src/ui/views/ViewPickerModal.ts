// The Kairos view picker (issue #17). The plugin used to add six ribbon icons,
// one per view; it now adds one, and that one opens this modal. The six commands
// stay in the command palette unchanged, so the modal is a convenience and a
// discovery surface rather than the only route into a view.
//
// The modal owns the chrome (backdrop, centered card, title, native close
// button) and the list itself is a Svelte component mounted into contentEl —
// the same split StatusHistoryModal uses. The list's styling is scoped inside
// that component rather than added to styles.css.

import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import ViewPicker from "./ViewPicker.svelte";
import type Kairos from "../../main";

/** One row of the picker: the view's icon, its name, what it is for, how to open it. */
export interface ViewPickerEntry {
	/** Lucide icon name — the same icon the view returns from `getIcon()`. */
	icon: string;
	/** The view's name, matching its tab title. */
	name: string;
	/** One line on what the view is for. */
	blurb: string;
	/** Activate the view. */
	open: () => void;
}

/**
 * The six views, in the order the ribbon used to list them. Icons are kept in
 * step with each view's own `getIcon()` so a row in the picker and the tab it
 * opens carry the same mark.
 */
export function kairosViews(plugin: Kairos): ViewPickerEntry[] {
	return [
		{
			icon: "clock",
			name: "Day",
			blurb: "Today's daily note as a timeline, with tasks inside their blocks.",
			open: () => void plugin.activateView(),
		},
		{
			icon: "calendar-range",
			name: "Week",
			blurb: "Several days side by side on one time axis; drag a block between them.",
			open: () => void plugin.activateWeekView(),
		},
		{
			icon: "layout-grid",
			name: "Grid",
			blurb: "Projects and domains against days, for triaging what belongs where.",
			open: () => void plugin.activateGridView(),
		},
		{
			icon: "inbox",
			name: "Backlog",
			blurb: "Everything captured but not scheduled, grouped by what it belongs to.",
			open: () => void plugin.activateBacklogView(),
		},
		{
			icon: "folder-kanban",
			name: "Projects & domains",
			blurb: "The durable list: domains, the projects under them, and their status.",
			open: () => void plugin.activateProjectsView(),
		},
		{
			icon: "gantt-chart",
			name: "Timeline",
			blurb: "When each project was active, as spans across time.",
			open: () => void plugin.activateGanttView(),
		},
	];
}

export class ViewPickerModal extends Modal {
	private component?: ReturnType<typeof mount>;

	constructor(
		app: App,
		private readonly entries: ViewPickerEntry[],
	) {
		super(app);
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText("Kairos views");

		this.component = mount(ViewPicker as Component, {
			target: contentEl,
			props: {
				entries: this.entries,
				// Close first, so the view opens into a workspace with no modal over
				// it and focus lands where the user is now looking.
				onPick: (entry: ViewPickerEntry) => {
					this.close();
					entry.open();
				},
			},
		});
	}

	onClose() {
		if (this.component) {
			void unmount(this.component);
			this.component = undefined;
		}
		this.contentEl.empty();
	}
}

/** Open the picker for this plugin instance — the ribbon icon's one job. */
export function openViewPicker(plugin: Kairos) {
	new ViewPickerModal(plugin.app, kairosViews(plugin)).open();
}
