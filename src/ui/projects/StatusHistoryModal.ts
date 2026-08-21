// A native Obsidian modal wrapping the editable status-history log. The modal
// owns the chrome (backdrop, centered card, title, native close button); the
// rich, reactive log — record list, inline edit, add-at-date with the shared
// Svelte Datepicker — is a Svelte component (StatusHistoryContent) mounted into
// the modal's contentEl. Using Obsidian's Modal (rather than our own portaled
// scrim) means the history overlay matches every other modal in the app and its
// buttons pick up Obsidian's native styling.
//
// The open row is addressed by its stable source.path + kind; the content
// component re-resolves it from the live index feed, so edits refresh in place.

import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import StatusHistoryContent from "./StatusHistoryContent.svelte";
import type { KairosIndex } from "../../index";

export class StatusHistoryModal extends Modal {
	private component?: ReturnType<typeof mount>;

	constructor(
		app: App,
		private readonly index: KairosIndex,
		private readonly opts: { name: string; path: string; isDomain: boolean },
	) {
		super(app);
	}

	onOpen() {
		const { contentEl, titleEl, modalEl } = this;
		modalEl.addClass("kairos-history-modal");
		titleEl.setText(this.opts.name);
		titleEl.createSpan({ cls: "kairos-history-sub", text: "Status history" });

		this.component = mount(StatusHistoryContent as Component, {
			target: contentEl,
			props: {
				index: this.index,
				path: this.opts.path,
				isDomain: this.opts.isDomain,
			},
		});
	}

	onClose() {
		if (this.component) {
			void unmount(this.component);
			this.component = undefined;
		}
		this.contentEl.empty();
	}
}
