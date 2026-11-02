// The tour's floating card and the ring it draws around what it points at.
// Both live on the document body, `fixed`, and are moved every frame by the
// tour (tour.ts), because what they point at moves: the sidebar resizes, the
// timeline scrolls, a block is dragged. The ring never takes the pointer, so
// the person can act on the very thing it circles.

import { setIcon } from "obsidian";
import { placePopover } from "./placement";
import type { Rect } from "./placement";

export interface PopoverAction {
	label: string;
	cta?: boolean;
	onClick: () => void;
}

export interface PopoverContent {
	/** "Step 2 of 6", or empty on the last step. */
	progress: string;
	title: string;
	/** Copy with `**bold**` for literal UI labels. */
	body: string;
	link?: { text: string; href: string };
	actions: PopoverAction[];
	onClose: () => void;
}

/** Append `text` to `el`, turning each `**label**` into a <strong>. */
function renderInline(el: HTMLElement, text: string) {
	text.split("**").forEach((part, i) => {
		if (!part) return;
		if (i % 2 === 1) el.createEl("strong", { text: part });
		else el.appendText(part);
	});
}

export class TourPopover {
	private readonly ring: HTMLElement;
	private readonly card: HTMLElement;

	constructor(doc: Document) {
		this.ring = doc.body.createDiv({ cls: "kairos-tour-ring" });
		this.card = doc.body.createDiv({ cls: "kairos-tour-card" });
		this.card.setAttr("role", "dialog");
	}

	render(content: PopoverContent) {
		const card = this.card;
		card.empty();

		const head = card.createDiv({ cls: "kairos-tour-head" });
		head.createSpan({ cls: "kairos-tour-progress", text: content.progress });
		const close = head.createEl("button", {
			cls: "kairos-tour-close clickable-icon",
			attr: { "aria-label": "End tour" },
		});
		setIcon(close, "x");
		close.addEventListener("click", content.onClose);

		card.createDiv({ cls: "kairos-tour-title", text: content.title });
		renderInline(card.createDiv({ cls: "kairos-tour-body" }), content.body);

		if (content.link) {
			card.createDiv({ cls: "kairos-tour-body" }).createEl("a", {
				text: content.link.text,
				href: content.link.href,
			});
		}

		const actions = card.createDiv({ cls: "kairos-tour-actions" });
		for (const action of content.actions) {
			const btn = actions.createEl("button", {
				text: action.label,
				cls: action.cta ? "mod-cta" : "",
			});
			btn.addEventListener("click", action.onClick);
		}
	}

	/** Circle `anchor` (or nothing) and move the card beside it. */
	position(anchor: Rect | null) {
		const win = this.card.win;
		if (anchor) {
			const pad = 4;
			this.ring.removeClass("is-hidden");
			this.ring.setCssStyles({
				left: `${anchor.left - pad}px`,
				top: `${anchor.top - pad}px`,
				width: `${anchor.width + pad * 2}px`,
				height: `${anchor.height + pad * 2}px`,
			});
		} else {
			this.ring.addClass("is-hidden");
		}

		const placed = placePopover(
			anchor,
			{ width: this.card.offsetWidth, height: this.card.offsetHeight },
			{ width: win.innerWidth, height: win.innerHeight },
		);
		this.card.setCssStyles({ left: `${placed.left}px`, top: `${placed.top}px` });
	}

	destroy() {
		this.ring.remove();
		this.card.remove();
	}
}
