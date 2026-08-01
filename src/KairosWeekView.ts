import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import WeekView from "./ui/timeline/WeekView.svelte";
import type Kairos from "./main";

export const KAIROS_WEEK_VIEW_TYPE = "kairos-week-view";

// The Week view: a main-leaf timeline of several daily notes side by side. It
// shares the Day view's time axis (one gutter, one geometry) and renders each
// day as a DayColumn. Blocks can be dragged between columns (a cross-day move,
// applied atomically through the index).
export class KairosWeekView extends ItemView {
	plugin: Kairos;
	private component?: ReturnType<typeof mount>;

	constructor(leaf: WorkspaceLeaf, plugin: Kairos) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KAIROS_WEEK_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Week";
	}

	getIcon(): string {
		return "calendar-range";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();

		this.component = mount(WeekView as Component, {
			target: container,
			props: {
				app: this.app,
				index: this.plugin.indexAdapter.index,
				settings: this.plugin.settings,
				saveSettings: () => void this.plugin.saveSettings(),
			},
		});
	}

	async onClose() {
		if (this.component) {
			void unmount(this.component);
			this.component = undefined;
		}
	}
}
