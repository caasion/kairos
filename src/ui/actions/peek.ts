// A Svelte action that reveals the full text of a truncated (ellipsized) label
// in a small floating card, so a long task or title can be read without
// entering edit mode.
//
//   • Mouse: hover the label for `delay` ms.
//   • Touch / pen: press and hold for `delay` ms, then release without moving.
//     A hold that moves is left alone, so it can still start a drag.
//
// The card only opens when the label is actually cut off (or `always` is set),
// so hovering a label that already fits shows nothing. Only one card is ever
// open; any press, scroll, or Escape closes it.
//
// Usage:
//   <span use:peek>{task.text}</span>
//   <div use:peek={{ text: note, detail: "1 Jan → now", measure: () => labelEl }}>…</div>
//
// Callers that own the touch gesture themselves (Task, whose hold also arms a
// drag) pass `touch: false` and call `showPeek` directly when the hold releases.

import { placeUnderAnchor } from "../floating";

export interface PeekOptions {
	/** The full text to show. Defaults to the node's text content. */
	text?: string;
	/** An optional muted second line (e.g. a date range). */
	detail?: string;
	/** The element whose overflow decides whether to open. Defaults to the node. */
	measure?: () => HTMLElement | undefined | null;
	/** Open even when nothing is truncated (for cards that carry a `detail`). */
	always?: boolean;
	/** Handle the touch hold-and-release gesture here. Default true. */
	touch?: boolean;
	/** Hover / hold time before the card opens, in ms. */
	delay?: number;
}

/** Pointer travel (px) past which a hold counts as a drag, not a peek. */
export const PEEK_SLOP = 8;
const DEFAULT_DELAY = 400;

/**
 * Whether a box's content overflows it — i.e. the browser is ellipsizing or
 * clamping it. Allows a 1px rounding tolerance so subpixel layouts don't read
 * as truncated.
 */
export function isTruncated(m: {
	scrollWidth: number;
	clientWidth: number;
	scrollHeight: number;
	clientHeight: number;
}): boolean {
	return m.scrollWidth > m.clientWidth + 1 || m.scrollHeight > m.clientHeight + 1;
}

/** Whether a pointer has travelled far enough from where it went down to be a drag. */
export function movedPastSlop(
	from: { clientX: number; clientY: number },
	to: { clientX: number; clientY: number },
	slop = PEEK_SLOP,
): boolean {
	return Math.hypot(to.clientX - from.clientX, to.clientY - from.clientY) > slop;
}

// ── The single shared card ──

let card: HTMLElement | null = null;
let cardOwner: HTMLElement | null = null;

function onDismissPointer(event: PointerEvent) {
	if (card && event.target instanceof Node && card.contains(event.target)) return;
	hidePeek();
}
function onDismissKey(event: KeyboardEvent) {
	if (event.key === "Escape") hidePeek();
}

/** Close the card, if open. */
export function hidePeek(): void {
	if (!card) return;
	card.remove();
	card = null;
	cardOwner = null;
	document.removeEventListener("pointerdown", onDismissPointer, true);
	document.removeEventListener("keydown", onDismissKey, true);
	window.removeEventListener("scroll", hidePeek, true);
	window.removeEventListener("resize", hidePeek);
}

/**
 * Open the card for `anchor`, below it (flipped above near the bottom edge).
 * Replaces any card already open.
 */
export function showPeek(anchor: HTMLElement, text: string, detail?: string): void {
	hidePeek();
	if (!text && !detail) return;

	const el = document.body.createDiv({ cls: "kairos-peek" });
	if (text) el.createDiv({ cls: "kairos-peek-text", text });
	if (detail) el.createDiv({ cls: "kairos-peek-detail", text: detail });

	// Measure at its natural size before placing, so the flip/clamp is exact.
	const rect = anchor.getBoundingClientRect();
	el.setAttr(
		"style",
		placeUnderAnchor(rect, { width: el.offsetWidth, height: el.offsetHeight, margin: 4 }),
	);

	card = el;
	cardOwner = anchor;
	// Deferred a tick: the press that opened the card (touch release) must not
	// immediately close it.
	window.setTimeout(() => {
		if (card !== el) return;
		document.addEventListener("pointerdown", onDismissPointer, true);
		document.addEventListener("keydown", onDismissKey, true);
		window.addEventListener("scroll", hidePeek, true);
		window.addEventListener("resize", hidePeek);
	}, 0);
}

/** Show the card for a node if it's truncated (or `always`), per its options. */
export function peekIfTruncated(node: HTMLElement, opts: PeekOptions = {}): boolean {
	const target = opts.measure?.() ?? node;
	if (!opts.always && !isTruncated(target)) return false;
	const text = opts.text ?? target.textContent?.trim() ?? "";
	showPeek(node, text, opts.detail);
	return true;
}

export function peek(node: HTMLElement, initial: PeekOptions = {}) {
	let opts = initial;
	let timer: number | undefined;
	// Touch hold state.
	let down: PointerEvent | undefined;
	let matured = false;
	let moved = false;
	// Swallow the click that trails a touch release that opened the card, so a
	// peek doesn't also start editing.
	let swallowClick = false;

	const delay = () => opts.delay ?? DEFAULT_DELAY;

	function clearTimer() {
		if (timer !== undefined) {
			window.clearTimeout(timer);
			timer = undefined;
		}
	}

	function onEnter(event: PointerEvent) {
		if (event.pointerType !== "mouse") return;
		clearTimer();
		timer = window.setTimeout(() => {
			timer = undefined;
			peekIfTruncated(node, opts);
		}, delay());
	}

	function onLeave(event: PointerEvent) {
		if (event.pointerType !== "mouse") return;
		clearTimer();
		if (cardOwner === node) hidePeek();
	}

	function onDown(event: PointerEvent) {
		clearTimer();
		if (event.pointerType === "mouse") {
			// A click means the user is acting on the label, not reading it.
			if (cardOwner === node) hidePeek();
			return;
		}
		if (opts.touch === false) return;
		down = event;
		matured = false;
		moved = false;
		timer = window.setTimeout(() => {
			timer = undefined;
			matured = true;
		}, delay());
	}

	function onMove(event: PointerEvent) {
		if (!down || event.pointerId !== down.pointerId) return;
		if (movedPastSlop(down, event)) {
			moved = true;
			clearTimer();
		}
	}

	function onUp(event: PointerEvent) {
		if (!down || event.pointerId !== down.pointerId) return;
		clearTimer();
		if (matured && !moved && peekIfTruncated(node, opts)) swallowClick = true;
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

	node.addEventListener("pointerenter", onEnter);
	node.addEventListener("pointerleave", onLeave);
	node.addEventListener("pointerdown", onDown);
	node.addEventListener("pointermove", onMove);
	node.addEventListener("pointerup", onUp);
	node.addEventListener("pointercancel", onCancel);
	node.addEventListener("click", onClick, true);

	return {
		update(next: PeekOptions = {}) {
			opts = next;
		},
		destroy() {
			clearTimer();
			if (cardOwner === node) hidePeek();
			node.removeEventListener("pointerenter", onEnter);
			node.removeEventListener("pointerleave", onLeave);
			node.removeEventListener("pointerdown", onDown);
			node.removeEventListener("pointermove", onMove);
			node.removeEventListener("pointerup", onUp);
			node.removeEventListener("pointercancel", onCancel);
			node.removeEventListener("click", onClick, true);
		},
	};
}
