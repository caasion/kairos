// A modal that asks when something repeats — "Repeat…" on a task, and
// "Change when it repeats" in the Routines view. Hosts the RulePicker and
// confirms with one button; closing any other way changes nothing.

import { App, Modal, Setting } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import RulePicker from "./RulePicker.svelte";
import type { Rule } from "../../routines/rules";

export interface RuleModalOptions {
	title: string;
	/** A line under the title saying what will happen. */
	description?: string;
	initial: Rule;
	confirm: string;
	onConfirm: (rule: Rule) => void;
}

export class RuleModal extends Modal {
	private rule: Rule;
	private picker?: ReturnType<typeof mount>;

	constructor(app: App, private options: RuleModalOptions) {
		super(app);
		this.rule = options.initial;
	}

	onOpen(): void {
		const { contentEl, titleEl, options } = this;
		titleEl.setText(options.title);
		if (options.description) {
			contentEl.createEl("p", { text: options.description, cls: "k-rule-modal-desc" });
		}
		this.picker = mount(RulePicker as Component, {
			target: contentEl.createDiv(),
			props: {
				initial: options.initial,
				onChange: (rule: Rule) => {
					this.rule = rule;
				},
			},
		});
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(options.confirm)
					.setCta()
					.onClick(() => {
						this.close();
						options.onConfirm(this.rule);
					}),
			);
	}

	onClose(): void {
		if (this.picker) {
			void unmount(this.picker);
			this.picker = undefined;
		}
		this.contentEl.empty();
	}
}
