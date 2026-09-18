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
//
// Dragging is on Pointer Events rather than HTML5 drag-and-drop, which never
// fires on touch. The list is not re-ordered mid-drag: re-rendering would
// destroy the element holding the pointer capture and strand the gesture, so a
// drop target is marked while dragging and the move is committed on pointerup.

import { App, Modal, Setting } from "obsidian";
import type { Domain } from "../../types";

export class DomainReorderModal extends Modal {
	private order: Domain[];
	private readonly onSave: (ordered: Domain[]) => void;
	private listEl!: HTMLElement;
	private dragFrom: number | null = null;
	private dragTo: number | null = null;

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
			row.addEventListener("pointerdown", (ev) => {
				// Let the arrow buttons keep their own click handling.
				if (ev.button !== 0 || (ev.target as HTMLElement).closest("button")) return;
				ev.preventDefault();
				this.dragFrom = i;
				this.dragTo = i;
				row.setPointerCapture(ev.pointerId);
				row.addClass("is-dragging");
			});

			row.addEventListener("pointermove", (ev) => {
				if (this.dragFrom === null) return;
				const to = this.rowIndexAt(ev.clientY);
				if (to === null || to === this.dragTo) return;
				this.dragTo = to;
				this.markDropTarget(to);
			});

			const endDrag = (ev: PointerEvent) => {
				if (this.dragFrom === null) return;
				const from = this.dragFrom;
				const to = this.dragTo;
				this.dragFrom = null;
				this.dragTo = null;
				if (row.hasPointerCapture(ev.pointerId)) {
					row.releasePointerCapture(ev.pointerId);
				}
				row.removeClass("is-dragging");
				this.clearDropTarget();
				// renderList() runs inside move(), so this is the single re-render.
				if (to !== null && to !== from) this.move(from, to);
			};
			row.addEventListener("pointerup", endDrag);
			row.addEventListener("pointercancel", endDrag);
		});
	}

	/** Index of the row under `clientY`, or null when the pointer is off the list. */
	private rowIndexAt(clientY: number): number | null {
		const rows = Array.from(this.listEl.children);
		for (let i = 0; i < rows.length; i++) {
			const rect = rows[i]?.getBoundingClientRect();
			if (rect && clientY >= rect.top && clientY <= rect.bottom) return i;
		}
		return null;
	}

	private markDropTarget(index: number) {
		Array.from(this.listEl.children).forEach((el, i) => {
			el.toggleClass("is-drop-target", i === index);
		});
	}

	private clearDropTarget() {
		Array.from(this.listEl.children).forEach((el) => {
			el.removeClass("is-drop-target");
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
