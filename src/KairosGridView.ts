import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import GridView from "./ui/grid/GridView.svelte";
import type Kairos from "./main";
import type { KairosSettings } from "./settings";

export const KAIROS_GRID_VIEW_TYPE = "kairos-grid-view";

// The Grid view: a main-leaf table for triaging tasks against their
// projects/domains (spec §5). Rows are associations (projects, domains, and an
// unassigned catch-all), columns are days, and each cell holds the tasks tied
// to that row on that day. Domains can be expanded into their child projects.
export class KairosGridView extends ItemView {
	plugin: Kairos;
	private component?: ReturnType<typeof mount>;

	constructor(leaf: WorkspaceLeaf, plugin: Kairos) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KAIROS_GRID_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Grid";
	}

	getIcon(): string {
		return "layout-grid";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();

		this.component = mount(GridView as Component, {
			target: container,
			props: {
				app: this.app,
				index: this.plugin.indexAdapter.index,
				settings$: this.plugin.settings$,
				updateSettings: (mutate: (s: KairosSettings) => void) =>
					void this.plugin.updateSettings(mutate),
				reveal: (date: string, blockLine: number) =>
					void this.plugin.revealInDayView(date, blockLine),
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
