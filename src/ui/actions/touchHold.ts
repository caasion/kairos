// Hold, then drag, on touch (spec decisions 130 and 136). A press on a
// timeline block's body or on empty time starts its move or create at once
// with a mouse. On touch that same press is how a swipe begins, so the
// gesture starts only once the finger has stayed put for `HOLD_TO_DRAG_MS`.
// A finger that moves first is a scroll and is left to the browser.
//
// Once the hold matures the page must stop scrolling under the drag. A
// `touch-action` can't change mid-touch, so a non-passive `touchmove` listener
// cancels the scroll until the finger lifts.

import { movedPastSlop } from "./peek";

/** How long a finger stays put before a press becomes a drag. */
export const HOLD_TO_DRAG_MS = 350;

/** A press that moves farther than this before maturing is a scroll. */
const HOLD_SLOP_PX = 8;

/**
 * Whether a press inside a block landed on something with its own hold or
 * tap: a task (hold to drag it, hold to peek), the action bar, a field. On
 * touch such a press never starts the block's own hold.
 */
export function pressOnBlockChild(target: EventTarget | null): boolean {
	// Duck-typed: `instanceof Element` fails across pop-out windows.
	const el = target as Partial<Element> | null;
	return (
		typeof el?.closest === "function" &&
		el.closest(".kairos-item, .kairos-action-bar, input, textarea") !== null
	);
}

/**
 * Run `begin` now for a mouse press, or after a hold for touch and pen.
 * Returns whether `begin` ran synchronously.
 */
export function startAfterHold(press: PointerEvent, begin: () => void): boolean {
	if (press.pointerType === "mouse") {
		begin();
		return true;
	}
	const win = (press.target as Node | null)?.ownerDocument?.defaultView ?? window;
	const id = press.pointerId;
	const timer = win.setTimeout(mature, HOLD_TO_DRAG_MS);

	function onMove(e: PointerEvent) {
		if (e.pointerId === id && movedPastSlop(press, e, HOLD_SLOP_PX)) stop();
	}
	function onEnd(e: PointerEvent) {
		if (e.pointerId === id) stop();
	}
	function stop() {
		win.clearTimeout(timer);
		win.removeEventListener("pointermove", onMove);
		win.removeEventListener("pointerup", onEnd);
		win.removeEventListener("pointercancel", onEnd);
	}
	function mature() {
		stop();
		holdScrollUntilLift(win);
		begin();
	}

	win.addEventListener("pointermove", onMove);
	win.addEventListener("pointerup", onEnd);
	win.addEventListener("pointercancel", onEnd);
	return false;
}

/** Fingers whose hold matured and haven't lifted: a drag of ours is live. */
let held = 0;

/** Whether a hold-started drag is live (a swipe then isn't one). */
export function holdingDrag(): boolean {
	return held > 0;
}

/**
 * Cancel touch scrolling until every finger has lifted, and the right-click a
 * long-press sends on Android and Chrome, which would open a menu mid-drag.
 */
function holdScrollUntilLift(win: Window) {
	held++;
	const noScroll = (e: TouchEvent) => {
		if (e.cancelable) e.preventDefault();
	};
	const noMenu = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
	};
	win.addEventListener("contextmenu", noMenu, true);
	const done = (e: TouchEvent) => {
		if (e.touches.length > 0) return;
		held = Math.max(0, held - 1);
		// The right-click can trail the lift; drop it a moment longer.
		win.setTimeout(() => win.removeEventListener("contextmenu", noMenu, true), 300);
		win.removeEventListener("touchmove", noScroll);
		win.removeEventListener("touchend", done);
		win.removeEventListener("touchcancel", done);
	};
	win.addEventListener("touchmove", noScroll, { passive: false });
	win.addEventListener("touchend", done);
	win.addEventListener("touchcancel", done);
}
