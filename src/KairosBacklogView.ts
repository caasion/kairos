import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import BacklogView from "./ui/backlog/BacklogView.svelte";
import type Kairos from "./main";

export const KAIROS_BACKLOG_VIEW_TYPE = "kairos-backlog-view";

// The Backlog view: a main-leaf list of unscheduled intentions grouped by
// association (spec §2.6, §5). Reads the index's `backlog()` store; scheduling
// an entry hands it to a day via the index. Purely a mount point — all logic
// lives in the Svelte component and the index.
export class KairosBacklogView extends ItemView {
	plugin: Kairos;
	private component?: ReturnType<typeof mount>;

	constructor(leaf: WorkspaceLeaf, plugin: Kairos) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KAIROS_BACKLOG_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Backlog";
	}

	getIcon(): string {
		return "inbox";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();

		this.component = mount(BacklogView as Component, {
			target: container,
			props: {
				app: this.app,
				index: this.plugin.indexAdapter.index,
				settings$: this.plugin.settings$,
				filter$: this.plugin.backlogFilter$,
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
