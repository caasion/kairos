import { ItemView, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { mount, unmount } from "svelte";
import { get, writable } from "svelte/store";
import type { Component } from "svelte";
import RoutinesView from "./ui/routines/RoutinesView.svelte";
import type Kairos from "./main";

export const KAIROS_ROUTINES_VIEW_TYPE = "kairos-routines-view";

/** The Routines view's two ways to show the same routines. */
export type RoutinesMode = "list" | "week";

// The Routines view: a main-leaf list of every routine in the routines file,
// grouped by when it repeats, or the week they produce. Purely a mount point —
// the component reads the plugin's RoutinesStore and writes through it. List
// or Week is the view's state, so Obsidian saves it with the workspace.
export class KairosRoutinesView extends ItemView {
	plugin: Kairos;
	private component?: ReturnType<typeof mount>;
	private mode$ = writable<RoutinesMode>("list");

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

	getState(): Record<string, unknown> {
		return { ...super.getState(), mode: get(this.mode$) };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const mode = (state as { mode?: unknown } | null)?.mode;
		if (mode === "list" || mode === "week") this.mode$.set(mode);
		await super.setState(state, result);
	}

	async onOpen() {
		// A switch is saved with the workspace, like a scroll position.
		this.register(this.mode$.subscribe(() => this.app.workspace.requestSaveLayout()));

		const container = this.contentEl;
		container.empty();

		this.component = mount(RoutinesView as Component, {
			target: container,
			props: {
				app: this.app,
				index: this.plugin.indexAdapter.index,
				store: this.plugin.routines,
				active$: this.plugin.routinesFeed.active$,
				mode$: this.mode$,
				settings$: this.plugin.settings$,
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
