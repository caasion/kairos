// A native Obsidian modal for reordering the domain list.
//
// Domain order is global (it drives the top-level row order on the Projects &
// Domains page and anywhere domains are listed), so reordering isn't a per-row
// concern — it's a single "arrange the whole list" gesture. This modal presents
// the domains as a draggable list; on Save it hands the caller the domains in
// their new order, and the page persists the new indices.
//
// Projects are deliberately NOT reorderable — they follow Obsidian's file sort
// order — so this modal only ever deals with domains.
//
// Styling lives in styles.css under `.kairos-reorder-*` (Obsidian's lint rule
// forbids inline element.style assignments); only the per-domain color swatch,
// which is data-driven, is set via a CSS custom property.

import { App, Modal, Setting } from "obsidian";
import type { Domain } from "../../types";

export class DomainReorderModal extends Modal {
	private order: Domain[];
	private readonly onSave: (ordered: Domain[]) => void;
	private listEl!: HTMLElement;

	constructor(app: App, domains: Domain[], onSave: (ordered: Domain[]) => void) {
		super(app);
		this.order = [...domains];
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText("Reorder domains");

		contentEl.createEl("p", {
			text: "Drag a domain, or use the arrows, to set the global order.",
			cls: "kairos-reorder-hint",
		});

		this.listEl = contentEl.createDiv({ cls: "kairos-reorder-list" });
		this.renderList();

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						this.onSave(this.order);
						this.close();
					}),
			);
	}

	private move(from: number, to: number) {
		if (to < 0 || to >= this.order.length) return;
		const [item] = this.order.splice(from, 1);
		if (!item) return;
		this.order.splice(to, 0, item);
		this.renderList();
	}

	private renderList() {
		this.listEl.empty();

		this.order.forEach((domain, i) => {
			const row = this.listEl.createDiv({ cls: "kairos-reorder-row" });
			row.setAttr("draggable", "true");

			const swatch = row.createSpan({ cls: "kairos-reorder-swatch" });
			swatch.style.setProperty("--swatch", domain.color || "var(--text-faint)");

			row.createSpan({ cls: "kairos-reorder-name", text: domain.name });

			const up = row.createEl("button", { cls: "kairos-reorder-move", text: "↑" });
			const down = row.createEl("button", { cls: "kairos-reorder-move", text: "↓" });
			up.disabled = i === 0;
			down.disabled = i === this.order.length - 1;
			up.onclick = () => this.move(i, i - 1);
			down.onclick = () => this.move(i, i + 1);

			// ── Drag to reorder ──
			row.addEventListener("dragstart", (ev) => {
				ev.dataTransfer?.setData("text/plain", String(i));
				row.addClass("is-dragging");
			});
			row.addEventListener("dragend", () => row.removeClass("is-dragging"));
			row.addEventListener("dragover", (ev) => ev.preventDefault());
			row.addEventListener("drop", (ev) => {
				ev.preventDefault();
				const from = Number(ev.dataTransfer?.getData("text/plain"));
				if (!Number.isNaN(from) && from !== i) this.move(from, i);
			});
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
