import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import GanttView from "./ui/gantt/GanttView.svelte";
import type Kairos from "./main";

export const KAIROS_GANTT_VIEW_TYPE = "kairos-gantt-view";

// The Gantt / strength view: a retrospective visualization of active/inactive
// spans and note-driven intensity across time, computed entirely from the
// project/domain status histories. It doubles as an editing surface — dragging a
// span boundary moves the date of the record that begins it, and clicking a span
// edits its status/note — all routed back through projectActions → the index,
// the same guarded path the Projects page uses. Purely a mount point.
export class KairosGanttView extends ItemView {
	plugin: Kairos;
	private component?: ReturnType<typeof mount>;

	constructor(leaf: WorkspaceLeaf, plugin: Kairos) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KAIROS_GANTT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Strength (Gantt)";
	}

	getIcon(): string {
		return "gantt-chart";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();

		this.component = mount(GanttView as Component, {
			target: container,
			props: {
				app: this.app,
				index: this.plugin.indexAdapter.index,
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
