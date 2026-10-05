// DOM side of the vertical action stack (EXPERIMENT). `actionZone` uses this
// when given `layout: "stack"`; the pure placement math is in
// actionStackGeometry.ts.
//
// The stack rises above the row, so the row's clipping ancestors (a timeline
// block's `overflow: hidden` content box, the grid table, a cell) would cut it
// off. Two ways out, in order of preference:
//
// 1. In place, `position: fixed`. The stack stays in the row's DOM, so tab
//    order, `:focus-within` and pointer containment (a pointer over a
//    descendant never fires the row's `pointerleave`, even outside the row's
//    box) all keep working. `fixed` escapes `overflow` clipping, except where
//    an ancestor is the containing block of fixed descendants (transform,
//    filter, contain, will-change, …). Obsidian's `.workspace-leaf` is one
//    (`contain: strict`), which is harmless: it's the whole pane, and the
//    stack is kept inside it anyway. A hovered timeline block is another
//    (`.tl-block:hover .tl-content { filter: brightness(…) }` on an
//    `overflow: hidden` box), which would clip. So this module finds the
//    actual containing block, positions relative to it, checks the result
//    would not be clipped, that it landed where intended and that nothing
//    paints over it (e.g. a sticky header), and otherwise:
// 2. Portal (mouse only). The stack moves to the document body while awake
//    and comes back to its spot in the row once it has faded out. The caller
//    then keeps it awake while the pointer is over the stack (it's no longer
//    a descendant, so the row sees a `pointerleave` when the pointer crosses
//    onto it). Keyboard focus never portals: moving a focused element blurs
//    it, and a stack at the end of the body would break tab order.

import {
	boxInside,
	clipsDescendants,
	formsFixedContainingBlock,
	intersectBoxes,
	placeActionStack,
	scrolls,
	type Box,
	type StackPlacement,
} from "./actionStackGeometry";

/** On the bar once the stack has been placed (styling hook for button order). */
export const ACTION_STACK_CLASS = "kairos-action-stack";
/** On the bar when the stack grows down from the corner instead of up. */
export const ACTION_STACK_DOWN_CLASS = "kairos-action-stack-down";
/** On the bar while it is portaled to the body. */
export const ACTION_STACK_PORTALED_CLASS = "kairos-action-stack-portaled";

function toBox(r: DOMRect): Box {
	return { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
}

/** The client box of `el`'s padding box (inside borders and scrollbars). */
function paddingBox(el: Element): Box {
	const r = el.getBoundingClientRect();
	const top = r.top + el.clientTop;
	const left = r.left + el.clientLeft;
	return { top, left, bottom: top + el.clientHeight, right: left + el.clientWidth };
}

/** The nearest ancestor of `el` that is the containing block for `fixed` boxes. */
function fixedContainingBlock(el: HTMLElement): HTMLElement | null {
	const win = el.ownerDocument.defaultView;
	if (!win) return null;
	for (let a = el.parentElement; a; a = a.parentElement) {
		if (formsFixedContainingBlock(win.getComputedStyle(a))) return a;
	}
	return null;
}

/**
 * Where the stack may go: the window, narrowed by every ancestor of `row`
 * that is actively scrolling (overflowing content) or paint-contained (e.g.
 * Obsidian's pane). Ancestors that merely clip (`overflow: hidden` on a block
 * or the grid table) don't count; escaping those is the point.
 */
function stackBounds(row: HTMLElement): Box {
	const doc = row.ownerDocument;
	const win = doc.defaultView;
	let bounds: Box = {
		top: 0,
		left: 0,
		bottom: win?.innerHeight ?? doc.documentElement.clientHeight,
		right: win?.innerWidth ?? doc.documentElement.clientWidth,
	};
	if (!win) return bounds;
	for (let a = row.parentElement; a && a !== doc.body; a = a.parentElement) {
		const style = win.getComputedStyle(a);
		const overflowing = a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1;
		const paintContained = /\b(paint|strict|content)\b/.test(style.contain);
		if ((scrolls(style) && overflowing) || paintContained) {
			bounds = intersectBoxes(bounds, paddingBox(a));
		}
	}
	return bounds;
}

/**
 * Whether a fixed box at `box`, whose containing block is `cb`, would be
 * clipped: `cb` and each of its ancestors clip it if they clip at all (the
 * row's other ancestors are skipped by `fixed`).
 */
function clippedInPlace(cb: HTMLElement | null, box: Box): boolean {
	const win = cb?.ownerDocument.defaultView;
	if (!cb || !win) return false;
	for (let a: HTMLElement | null = cb; a; a = a.parentElement) {
		if (clipsDescendants(win.getComputedStyle(a)) && !boxInside(box, paddingBox(a))) return true;
	}
	return false;
}

function applyPlacement(bar: HTMLElement, p: StackPlacement, cb: HTMLElement | null) {
	let left = p.left;
	let top = p.top;
	if (cb) {
		const r = cb.getBoundingClientRect();
		left = left - r.left - cb.clientLeft + cb.scrollLeft;
		top = top - r.top - cb.clientTop + cb.scrollTop;
	}
	// styles.css positions the stack from these.
	bar.setCssProps({ "--kairos-action-stack-left": `${left}px`, "--kairos-action-stack-top": `${top}px` });
	bar.classList.toggle(ACTION_STACK_DOWN_CLASS, p.direction === "down");
}

/**
 * Controls one row's stack: placement, the portal fallback, and putting the
 * bar back. `host` is the row; `bar` is its direct-child action bar.
 */
export class ActionStack {
	private placeholder: Comment | null = null;

	/**
	 * `onEnter`/`onLeave` are the bar's `pointerenter`/`pointerleave`, listened
	 * to only while portaled (in place, the row's own listeners see the bar).
	 */
	constructor(
		private readonly host: HTMLElement,
		readonly bar: HTMLElement,
		private readonly onEnter: (event: PointerEvent) => void,
		private readonly onLeave: (event: PointerEvent) => void,
	) {}

	get portaled(): boolean {
		return this.placeholder !== null;
	}

	/**
	 * Lay the bar out as a stack at the row's top-right corner. With
	 * `allowPortal` (a mouse wake) it moves to the body if staying in place
	 * would clip it or put it in the wrong spot; without (keyboard focus) it
	 * stays in place whatever happens.
	 */
	place(allowPortal: boolean) {
		const bar = this.bar;
		bar.classList.add(ACTION_STACK_CLASS);
		// One button wide: measure the stack itself, now that it's a column.
		const width = bar.offsetWidth;
		const height = bar.offsetHeight;
		const p = placeActionStack(this.host.getBoundingClientRect(), width, height, stackBounds(this.host));
		const intended: Box = { top: p.top, left: p.left, bottom: p.top + height, right: p.left + width };

		if (this.portaled) {
			applyPlacement(bar, p, null);
			return;
		}
		const cb = fixedContainingBlock(bar);
		if (allowPortal && clippedInPlace(cb, intended)) {
			this.portal();
			applyPlacement(bar, p, null);
			return;
		}
		applyPlacement(bar, p, cb);
		// Belt and braces: if a containing block slipped past the checks above,
		// the stack lands elsewhere. Portal rather than show it in the wrong spot.
		// And if something paints over it (a sticky header in a higher stacking
		// context), portal too. Hit-test the centres of its two end cells; the
		// caller has already made the bar pointer-reactive.
		if (
			allowPortal &&
			(!boxInside(toBox(bar.getBoundingClientRect()), intended, 1) || this.occluded(intended, width))
		) {
			this.portal();
			applyPlacement(bar, p, null);
		}
	}

	private occluded(box: Box, cell: number): boolean {
		const doc = this.host.ownerDocument;
		const x = box.left + cell / 2;
		for (const y of [box.top + cell / 2, box.bottom - cell / 2]) {
			const hit = doc.elementFromPoint(x, y);
			if (hit && !this.bar.contains(hit)) return true;
		}
		return false;
	}

	private portal() {
		const bar = this.bar;
		const doc = this.host.ownerDocument;
		this.placeholder = doc.createComment("kairos-action-stack");
		bar.before(this.placeholder);
		doc.body.appendChild(bar);
		bar.classList.add(ACTION_STACK_PORTALED_CLASS);
		bar.addEventListener("pointerenter", this.onEnter);
		bar.addEventListener("pointerleave", this.onLeave);
		bar.addEventListener("contextmenu", this.forwardContextMenu);
	}

	// A right-click on the portaled stack would miss the row's own menu (the
	// stack isn't its descendant now); hand it to the row as if it were.
	private readonly forwardContextMenu = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		this.host.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: event.clientX,
				clientY: event.clientY,
				screenX: event.screenX,
				screenY: event.screenY,
				button: event.button,
				buttons: event.buttons,
				ctrlKey: event.ctrlKey,
				shiftKey: event.shiftKey,
				altKey: event.altKey,
				metaKey: event.metaKey,
			}),
		);
	};

	/** Put a portaled bar back where it was in the row. */
	restore() {
		const ph = this.placeholder;
		if (!ph) return;
		this.placeholder = null;
		this.bar.removeEventListener("pointerenter", this.onEnter);
		this.bar.removeEventListener("pointerleave", this.onLeave);
		this.bar.removeEventListener("contextmenu", this.forwardContextMenu);
		this.bar.classList.remove(ACTION_STACK_PORTALED_CLASS);
		if (ph.parentNode) ph.replaceWith(this.bar);
		else this.bar.remove(); // the row is gone; don't leave the bar in the body
	}

	/** Restore and drop every trace of the stack layout. */
	destroy() {
		this.restore();
		this.bar.classList.remove(ACTION_STACK_CLASS, ACTION_STACK_DOWN_CLASS);
		this.bar.setCssProps({ "--kairos-action-stack-left": "", "--kairos-action-stack-top": "" });
	}
}
