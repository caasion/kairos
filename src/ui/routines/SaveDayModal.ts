// "Save this day as routines" — a modal over SaveDayPicker. Saves the picked
// blocks and tasks, each on its own rule, in one edit; closing any other way
// changes nothing. The Save button says what it will do: "Save 2, update 1".

import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import SaveDayPicker from "./SaveDayPicker.svelte";
import { defaultPick, planCounts, saveDayPlan, type SaveDayBlock, type SaveDayPick, type SaveDayPlan } from "../../routines/saveDay";
import type { Routine } from "../../routines/routinesFile";
import type { Rule } from "../../routines/rules";

export interface SaveDayModalOptions {
	/** The day, as the title names it: "Tue, Oct 13". */
	label: string;
	items: SaveDayBlock[];
	/** The whole routines file, for the overlap warnings. */
	routines: Routine[];
	initialRule: Rule;
	onSave: (plan: SaveDayPlan) => void;
}

/** "Save 2, update 1", "Save 3", "Update 1"; "Save" when nothing is picked. */
export function saveLabel(plan: SaveDayPlan): string {
	const { added, updated } = planCounts(plan);
	if (added > 0 && updated > 0) return `Save ${added}, update ${updated}`;
	if (updated > 0) return `Update ${updated}`;
	return added > 0 ? `Save ${added}` : "Save";
}

export class SaveDayModal extends Modal {
	private pick: SaveDayPick;
	private picker?: ReturnType<typeof mount>;
	private saveButton?: ButtonComponent;

	constructor(app: App, private options: SaveDayModalOptions) {
		super(app);
		this.pick = defaultPick(options.items, options.initialRule);
	}

	onOpen(): void {
		const { contentEl, titleEl, options } = this;
		titleEl.setText(`Save ${options.label} as routines`);
		contentEl.createEl("p", {
			text: "Pick what should repeat, and when. The day itself stays as it is.",
			cls: "k-rule-modal-desc",
		});
		this.picker = mount(SaveDayPicker as Component, {
			target: contentEl.createDiv(),
			props: {
				items: options.items,
				routines: options.routines,
				initialPick: this.pick,
				initialRule: options.initialRule,
				onChange: (pick: SaveDayPick) => {
					this.pick = pick;
					this.saveButton?.setButtonText(saveLabel(this.plan()));
				},
			},
		});
		const buttons = new Setting(contentEl).addButton((b) =>
			b.setButtonText("Cancel").onClick(() => this.close()),
		);
		if (options.items.length > 0) {
			buttons.addButton((b) => {
				this.saveButton = b;
				b.setButtonText(saveLabel(this.plan()))
					.setCta()
					.onClick(() => {
						const plan = this.plan();
						this.close();
						const { added, updated } = planCounts(plan);
						if (added + updated > 0) options.onSave(plan);
					});
			});
		}
	}

	private plan(): SaveDayPlan {
		return saveDayPlan(this.options.items, this.pick);
	}

	onClose(): void {
		if (this.picker) {
			void unmount(this.picker);
			this.picker = undefined;
		}
		this.contentEl.empty();
	}
}
