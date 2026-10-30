import { ItemView, Menu, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import DayView from "./ui/timeline/DayView.svelte";
import type Kairos from "./main";
import type { KairosSettings } from "./settings";
import type { ISODate } from "./types";
import { openSaveDay } from "./routines/register";
import { todayISO } from "./dayNote";

export const KAIROS_VIEW_TYPE = "kairos-day-view";

// The Day view: a sidebar timeline of the active daily note. Read-only for now
// — this renders the parser + resolver output as a positioned timeline with
// task chips inside blocks. Interactivity (drag/resize/create) comes later.
export class KairosView extends ItemView {
	plugin: Kairos;
	/** The date the view is showing, kept in sync by the component. */
	date?: ISODate;
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

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		const date = this.date;
		if (!date) return;
		menu.addItem((item) =>
			item
				.setTitle("Save this day as routines…")
				.setIcon("repeat")
				.setSection("action")
				.onClick(() => openSaveDay(this.plugin, date)),
		);
		const past = date < todayISO();
		menu.addItem((item) =>
			item
				.setTitle(past ? "Regenerate routines (past day)" : "Regenerate routines…")
				.setIcon("refresh-cw")
				.setSection("action")
				.setDisabled(past)
				.onClick(() => void this.plugin.dayPreparer.regenerate(date)),
		);
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
				reveal$: this.plugin.reveal$,
				updateSettings: (mutate: (s: KairosSettings) => void) =>
					void this.plugin.updateSettings(mutate),
				links: this.plugin.links,
				onDateChange: (date: ISODate) => {
					this.date = date;
					this.plugin.links.setDayDate(date);
				},
				routineActions: this.plugin.routinesFeed.actions(),
				leftoverActions: this.plugin.routinesFeed.leftoverActions(),
			},
		});
	}

	async onClose() {
		this.plugin.links.setDayDate(null);
		if (this.component) {
			void unmount(this.component);
			this.component = undefined;
		}
	}
}
