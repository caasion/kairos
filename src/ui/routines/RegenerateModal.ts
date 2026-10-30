// "Regenerate routines" — a preview of what bringing one day back in line
// with the routines file would change (regenerate.ts), one checkbox per
// change, grouped by kind. Apply hands back the keys of the checked changes;
// closing any other way changes nothing. Obsidian's own parts throughout:
// setting rows and headings, and `modal-button-container` for the buttons.

import { App, ButtonComponent, Modal, Setting } from "obsidian";
import type { Association } from "../../types";
import { formatTimeRange } from "../../parser";
import { checkedByDefault, type RegenChange, type RegenKind } from "../../routines/regenerate";

export interface RegenerateModalOptions {
	/** The day, as the title names it: "Thu, Oct 29". */
	label: string;
	changes: RegenChange[];
	/** A project's or domain's name as the user knows it. */
	assocName: (assoc: Association) => string;
	onApply: (keys: Set<string>) => void;
}

/** The groups, in the order the modal shows them. */
const GROUPS: { heading: string; kinds: RegenKind[] }[] = [
	{ heading: "Project or domain changed", kinds: ["assoc", "task-assoc"] },
	{ heading: "Tasks missing from a block", kinds: ["task"] },
	{ heading: "Routines missing from the day", kinds: ["missing"] },
	{ heading: "Time changed", kinds: ["time"] },
];

export class RegenerateModal extends Modal {
	private picked: Set<string>;
	private applyButton?: ButtonComponent;

	constructor(app: App, private options: RegenerateModalOptions) {
		super(app);
		this.picked = new Set(
			options.changes.filter((c) => checkedByDefault(c.kind)).map((c) => c.key),
		);
	}

	onOpen(): void {
		const { contentEl, titleEl, options } = this;
		titleEl.setText(`Regenerate routines for ${options.label}`);
		contentEl.addClass("kairos-regen");
		contentEl.createEl("p", {
			text: "Pick what to bring in line with your routines. Nothing is removed, and tasks keep whether they're done.",
			cls: "kairos-regen-desc",
		});

		const list = contentEl.createDiv({ cls: "kairos-regen-list" });
		for (const group of GROUPS) {
			const changes = options.changes.filter((c) => group.kinds.includes(c.kind));
			if (changes.length === 0) continue;
			new Setting(list).setName(group.heading).setHeading();
			for (const change of changes) this.row(list, change);
		}

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
		this.applyButton = new ButtonComponent(buttons)
			.setButtonText("Apply")
			.setCta()
			.onClick(() => {
				const keys = new Set(this.picked);
				this.close();
				if (keys.size > 0) options.onApply(keys);
			});
		this.refresh();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private row(parent: HTMLElement, change: RegenChange): void {
		const { name, desc } = describe(change, this.options.assocName);
		const setting = new Setting(parent).setName(name).setDesc(desc);
		setting.settingEl.addClass("kairos-regen-row");
		const box = setting.controlEl.createEl("input", { type: "checkbox" });
		box.checked = this.picked.has(change.key);
		box.setAttr("aria-label", `Apply: ${name}`);
		const set = (on: boolean) => {
			box.checked = on;
			if (on) this.picked.add(change.key);
			else this.picked.delete(change.key);
			this.refresh();
		};
		box.addEventListener("change", () => set(box.checked));
		// The whole row toggles, like a label.
		setting.infoEl.addEventListener("click", () => set(!box.checked));
	}

	private refresh(): void {
		this.applyButton?.setDisabled(this.picked.size === 0);
	}
}

/** A change as a row: what it's about, and what applying it does. */
function describe(
	change: RegenChange,
	assocName: (assoc: Association) => string,
): { name: string; desc: string } {
	const tag = (a: Association | undefined) => (a ? assocName(a) : "none");
	switch (change.kind) {
		case "assoc":
			return {
				name: change.routine.title,
				desc: `${tag(change.from)} → ${tag(change.to)}`,
			};
		case "task-assoc":
			return {
				name: change.routine.text,
				desc: `In ${change.block.title}: ${tag(change.from)} → ${tag(change.to)}`,
			};
		case "time":
			return {
				name: change.routine.title,
				desc: `Move from ${formatTimeRange(change.from)} to ${formatTimeRange(change.to)}`,
			};
		case "task":
			return { name: change.routine.text, desc: `Add to ${change.home}` };
		case "missing": {
			const r = change.routine;
			if (r.kind === "block") {
				const assoc = r.assoc ? ` · ${assocName(r.assoc)}` : "";
				return { name: r.title, desc: `Add the block at ${formatTimeRange(r.time)}${assoc}` };
			}
			const where = r.home ? `Add to ${r.home}, or Unscheduled if the day has no ${r.home}` : "Add to Unscheduled";
			return { name: r.text, desc: where };
		}
	}
}
