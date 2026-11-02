// A Svelte action for a small mark that opens a hover card: the Grid's
// intention and intensity marks. `peek` does this for text; this one only
// says when, so the owner can draw a richer card (a Popover) itself.
//
//   • Mouse: rest on the node for `delay` ms; leaving it closes the card.
//   • Touch / pen: press and hold for `delay` ms without moving. The card
//     opens while the finger is still down and stays open after it lifts,
//     until the next press anywhere, a scroll, or Escape. The click that
//     trails the hold is swallowed, so the press doesn't also act on the cell.
//
// Only one card is open at a time: opening one closes any other.
//
// Usage:
//   <span use:hoverHold={{ onopen: () => (open = true), onclose: () => (open = false) }}>…</span>

import { movedPastSlop } from "./peek";

export interface HoverHoldOptions {
	onopen: () => void;
	onclose: () => void;
	/** Hover / hold time before the card opens, in ms. */
	delay?: number;
}

const DEFAULT_DELAY = 250;

/** Closes whichever card is open, if any. */
let closeOpen: (() => void) | null = null;

export function hoverHold(node: HTMLElement, initial: HoverHoldOptions) {
	let opts = initial;
	let timer: number | undefined;
	let isOpen = false;
	// Touch hold state.
	let down: PointerEvent | undefined;
	let swallowClick = false;

	const win = node.ownerDocument.defaultView ?? window;
	const doc = node.ownerDocument;

	function clearTimer() {
		if (timer !== undefined) {
			win.clearTimeout(timer);
			timer = undefined;
		}
	}

	function onDismissPointer(event: PointerEvent) {
		// A press on the mark itself is handled by onDown.
		if (event.target instanceof Node && node.contains(event.target)) return;
		close();
	}
	function onDismissKey(event: KeyboardEvent) {
		if (event.key === "Escape") close();
	}

	function open() {
		if (isOpen) return;
		closeOpen?.();
		isOpen = true;
		closeOpen = close;
		opts.onopen();
		doc.addEventListener("pointerdown", onDismissPointer, true);
		doc.addEventListener("keydown", onDismissKey, true);
		win.addEventListener("scroll", close, true);
	}

	function close() {
		if (!isOpen) return;
		isOpen = false;
		if (closeOpen === close) closeOpen = null;
		doc.removeEventListener("pointerdown", onDismissPointer, true);
		doc.removeEventListener("keydown", onDismissKey, true);
		win.removeEventListener("scroll", close, true);
		opts.onclose();
	}

	function onEnter(event: PointerEvent) {
		if (event.pointerType !== "mouse") return;
		clearTimer();
		timer = win.setTimeout(() => {
			timer = undefined;
			open();
		}, opts.delay ?? DEFAULT_DELAY);
	}

	function onLeave(event: PointerEvent) {
		if (event.pointerType !== "mouse") return;
		clearTimer();
		close();
	}

	function onDown(event: PointerEvent) {
		clearTimer();
		if (event.pointerType === "mouse") return;
		close();
		down = event;
		swallowClick = false;
		timer = win.setTimeout(() => {
			timer = undefined;
			swallowClick = true;
			open();
		}, opts.delay ?? DEFAULT_DELAY);
	}

	function onMove(event: PointerEvent) {
		if (!down || event.pointerId !== down.pointerId) return;
		if (!isOpen && movedPastSlop(down, event)) {
			clearTimer();
			down = undefined;
		}
	}

	function onUp(event: PointerEvent) {
		if (!down || event.pointerId !== down.pointerId) return;
		clearTimer();
		down = undefined;
	}

	function onCancel() {
		clearTimer();
		down = undefined;
	}

	function onClick(event: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		event.stopImmediatePropagation();
		event.preventDefault();
	}

	// A held finger also brings up the system's context menu on some devices.
	function onContextMenu(event: Event) {
		if (down || isOpen) event.preventDefault();
	}

	node.addEventListener("pointerenter", onEnter);
	node.addEventListener("pointerleave", onLeave);
	node.addEventListener("pointerdown", onDown);
	node.addEventListener("pointermove", onMove);
	node.addEventListener("pointerup", onUp);
	node.addEventListener("pointercancel", onCancel);
	node.addEventListener("click", onClick, true);
	node.addEventListener("contextmenu", onContextMenu);

	return {
		update(next: HoverHoldOptions) {
			opts = next;
		},
		destroy() {
			clearTimer();
			close();
			node.removeEventListener("pointerenter", onEnter);
			node.removeEventListener("pointerleave", onLeave);
			node.removeEventListener("pointerdown", onDown);
			node.removeEventListener("pointermove", onMove);
			node.removeEventListener("pointerup", onUp);
			node.removeEventListener("pointercancel", onCancel);
			node.removeEventListener("click", onClick, true);
			node.removeEventListener("contextmenu", onContextMenu);
		},
	};
}
