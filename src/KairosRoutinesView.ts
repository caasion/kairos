import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import RoutinesView from "./ui/routines/RoutinesView.svelte";
import type Kairos from "./main";

export const KAIROS_ROUTINES_VIEW_TYPE = "kairos-routines-view";

// The Routines view: a main-leaf list of every routine in the routines file,
// grouped by when it repeats. Purely a mount point — the component reads the
// plugin's RoutinesStore and writes through it.
export class KairosRoutinesView extends ItemView {
	plugin: Kairos;
	private component?: ReturnType<typeof mount>;

	constructor(leaf: WorkspaceLeaf, plugin: Kairos) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KAIROS_ROUTINES_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Routines";
	}

	getIcon(): string {
		return "repeat";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();

		this.component = mount(RoutinesView as Component, {
			target: container,
			props: {
				app: this.app,
				index: this.plugin.indexAdapter.index,
				store: this.plugin.routines,
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
