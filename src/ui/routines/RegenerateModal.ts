// "Regenerate routines" — a preview of what bringing one day back in line
// with the routines file would change (regenerate.ts): the day drawn like the
// Day view beside the list of changes, one checkbox each (RegeneratePreview).
// Apply hands back the keys of the checked changes; closing any other way
// changes nothing. The buttons are Obsidian's own `modal-button-container`.

import { App, ButtonComponent, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import type { Block } from "../../types";
import type { Resolver } from "../../index";
import type { KairosSettings } from "../../settings";
import RegeneratePreview from "./RegeneratePreview.svelte";
import { checkedByDefault, type RegenChange } from "../../routines/regenerate";

export interface RegenerateModalOptions {
	/** The day, as the title names it: "Thu, Oct 29". */
	label: string;
	/** The day's blocks the changes were computed from. */
	blocks: Block[];
	changes: RegenChange[];
	/** The day's note, for the blocks the preview adds. */
	path: string;
	resolve: Resolver;
	settings: KairosSettings;
	onApply: (keys: Set<string>) => void;
}

export class RegenerateModal extends Modal {
	private picked: Set<string>;
	private applyButton?: ButtonComponent;
	private preview?: ReturnType<typeof mount>;

	constructor(app: App, private options: RegenerateModalOptions) {
		super(app);
		this.picked = new Set(
			options.changes.filter((c) => checkedByDefault(c.kind)).map((c) => c.key),
		);
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl, options } = this;
		modalEl.addClass("kairos-regen-modal");
		titleEl.setText(`Regenerate routines for ${options.label}`);
		contentEl.createEl("p", {
			text: "Check what to bring in line with your routines. Nothing is removed, and done tasks stay done.",
			cls: "kairos-regen-desc",
		});

		this.preview = mount(RegeneratePreview as Component, {
			target: contentEl.createDiv(),
			props: {
				blocks: options.blocks,
				changes: options.changes,
				path: options.path,
				resolve: options.resolve,
				settings: options.settings,
				initialPicked: this.picked,
				onChange: (picked: Set<string>) => {
					this.picked = picked;
					this.refresh();
				},
			},
		});

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
		this.applyButton = new ButtonComponent(buttons).setCta().onClick(() => {
			const keys = new Set(this.picked);
			this.close();
			if (keys.size > 0) options.onApply(keys);
		});
		this.refresh();
	}

	onClose(): void {
		if (this.preview) {
			void unmount(this.preview);
			this.preview = undefined;
		}
		this.contentEl.empty();
	}

	private refresh(): void {
		const n = this.picked.size;
		this.applyButton
			?.setButtonText(n === 0 ? "Apply" : `Apply ${n} change${n === 1 ? "" : "s"}`)
			.setDisabled(n === 0);
	}
}
