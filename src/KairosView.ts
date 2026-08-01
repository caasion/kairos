import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import DayView from "./ui/timeline/DayView.svelte";
import type Kairos from "./main";
import type { KairosSettings } from "./settings";

export const KAIROS_VIEW_TYPE = "kairos-day-view";

// The Day view: a sidebar timeline of the active daily note. Read-only for now
// — this renders the parser + resolver output as a positioned timeline with
// task chips inside blocks. Interactivity (drag/resize/create) comes later.
export class KairosView extends ItemView {
	plugin: Kairos;
	private component?: ReturnType<typeof mount>;

	constructor(leaf: WorkspaceLeaf, plugin: Kairos) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KAIROS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Day";
	}

	getIcon(): string {
		return "clock";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();

		this.component = mount(DayView as Component, {
			target: container,
			props: {
				app: this.app,
				index: this.plugin.indexAdapter.index,
				settings$: this.plugin.settings$,
				updateSettings: (mutate: (s: KairosSettings) => void) =>
					void this.plugin.updateSettings(mutate),
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
