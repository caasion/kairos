import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import ProjectsView from "./ui/projects/ProjectsView.svelte";
import type Kairos from "./main";

export const KAIROS_PROJECTS_VIEW_TYPE = "kairos-projects-view";

// The Projects & Domains view (spec §5 project page): a single main-leaf list
// with durable domains as top-level rows and their projects nested beneath. Reads
// the index's `projectsDomains()` store; edits (color, order, status, domain
// link, rename, create, delete) route back through the index. A "view backlog"
// button opens the Backlog view filtered to a domain (+ its projects) or a single
// project. Purely a mount point — all logic lives in the Svelte component, the
// index, and projectActions.
export class KairosProjectsView extends ItemView {
	plugin: Kairos;
	private component?: ReturnType<typeof mount>;

	constructor(leaf: WorkspaceLeaf, plugin: Kairos) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KAIROS_PROJECTS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Projects & domains";
	}

	getIcon(): string {
		return "folder-kanban";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();

		this.component = mount(ProjectsView as Component, {
			target: container,
			props: {
				app: this.app,
				index: this.plugin.indexAdapter.index,
				openBacklogFiltered: (names: string[], label: string) =>
					void this.plugin.openBacklogFiltered(names, label),
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
