// The dialog that adds one change to a project's or domain's status history, or
// edits one (with Delete). It's a native Obsidian modal: the title is the
// entity's name with "Add a change" or "Edit change" after it, and the fields
// and buttons are a Svelte component (StatusRecordDialog) mounted into it. The
// caller writes the record; the modal only collects it.

import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import type { ISODate, LifecycleState, StatusRecord } from "../../types";
import StatusRecordDialog from "./StatusRecordDialog.svelte";

/** A record as the dialog hands it back. */
export interface RecordDraft {
	date: ISODate;
	status: LifecycleState;
	note: string;
	why: string;
	/** Only for an active record; undefined is unset. */
	intensity?: number;
}

export class StatusRecordModal extends Modal {
	private component?: ReturnType<typeof mount>;

	constructor(
		app: App,
		private readonly opts: {
			name: string;
			states: LifecycleState[];
			/** The record to edit; leave out to add one. */
			initial?: StatusRecord;
			onSave: (draft: RecordDraft) => void;
			onDelete?: () => void;
		},
	) {
		super(app);
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		const { name, states, initial, onSave, onDelete } = this.opts;
		titleEl.setText(name);
		titleEl.createSpan({
			cls: "kairos-history-sub",
			text: initial ? "Edit change" : "Add a change",
		});

		this.component = mount(StatusRecordDialog as Component, {
			target: contentEl,
			props: {
				initial,
				states,
				onSave: (draft: RecordDraft) => {
					this.close();
					onSave(draft);
				},
				onDelete: onDelete
					? () => {
							this.close();
							onDelete();
						}
					: undefined,
				onCancel: () => this.close(),
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
