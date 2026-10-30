// "Save this day as routines" — a modal over SaveDayPicker. Saves the picked
// blocks and tasks on the chosen rule in one edit; closing any other way
// changes nothing.

import { App, Modal, Setting } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import SaveDayPicker from "./SaveDayPicker.svelte";
import { defaultPick, saveDayDrafts, type SaveDayBlock, type SaveDayPick } from "../../routines/saveDay";
import type { RoutineDraft } from "../../routines/routinesWriter";
import type { Rule } from "../../routines/rules";

export interface SaveDayModalOptions {
	/** The day, as the title names it: "Tue, Oct 13". */
	label: string;
	items: SaveDayBlock[];
	initialRule: Rule;
	onSave: (drafts: RoutineDraft[], rule: Rule) => void;
}

export class SaveDayModal extends Modal {
	private pick: SaveDayPick;
	private rule: Rule;
	private picker?: ReturnType<typeof mount>;

	constructor(app: App, private options: SaveDayModalOptions) {
		super(app);
		this.pick = defaultPick(options.items);
		this.rule = options.initialRule;
	}

	onOpen(): void {
		const { contentEl, titleEl, options } = this;
		titleEl.setText(`Save ${options.label} as routines`);
		contentEl.createEl("p", {
			text: "Pick what should repeat. The day itself stays as it is.",
			cls: "k-rule-modal-desc",
		});
		this.picker = mount(SaveDayPicker as Component, {
			target: contentEl.createDiv(),
			props: {
				items: options.items,
				initialPick: this.pick,
				initialRule: options.initialRule,
				onChange: (pick: SaveDayPick, rule: Rule) => {
					this.pick = pick;
					this.rule = rule;
				},
			},
		});
		const buttons = new Setting(contentEl).addButton((b) =>
			b.setButtonText("Cancel").onClick(() => this.close()),
		);
		if (options.items.length > 0) {
			buttons.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						const drafts = saveDayDrafts(options.items, this.pick, this.rule);
						this.close();
						if (drafts.length > 0) options.onSave(drafts, this.rule);
					}),
			);
		}
	}

	onClose(): void {
		if (this.picker) {
			void unmount(this.picker);
			this.picker = undefined;
		}
		this.contentEl.empty();
	}
}
