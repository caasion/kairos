// Drag a Grid block by its header: a matured long-press lifts it once the
// pointer moves past the slop, as a task's text does (Task.svelte). Releasing
// in place does nothing, so a long hold never rewrites the note.
//
// A press on a control inside the header (its action bar, shown in place, or
// the rename input) is that control's, not the header's: it never arms the
// drag, so drag-selecting a title or holding a stack button can't lift the
// block. This has to be decided here, on the press itself. A `stopPropagation`
// in the control's Svelte `onpointerdown` can't do it: Svelte 5 delegates
// pointerdown to the root, so that handler runs after the header's own
// listeners have already seen the press.

import { longpress } from "./longpress";
import { movedPastSlop } from "./peek";

/** Controls inside a draggable header whose presses are their own. */
export const HOLD_EXEMPT_SELECTOR = ".kairos-action-bar, input, textarea";

/** Whether a press on `target` belongs to a control rather than the header. */
export function pressOnControl(target: EventTarget | null): boolean {
	// Duck-typed: `instanceof Element` fails across pop-out windows.
	const el = target as Partial<Element> | null;
	return typeof el?.closest === "function" && el.closest(HOLD_EXEMPT_SELECTOR) !== null;
}

type OnGrab = ((e: PointerEvent) => void) | undefined;

export function grabOnHold(node: HTMLElement, onGrab: OnGrab) {
	let current = onGrab;
	let press: PointerEvent | undefined;
	let cleanup: (() => void) | undefined;
	const win = node.ownerDocument.defaultView ?? window;
	const finish = () => {
		press = undefined;
		node.classList.remove("held");
		cleanup?.();
		cleanup = undefined;
	};
	const down = (e: PointerEvent) => {
		press = e.button === 0 && !pressOnControl(e.target) ? e : undefined;
	};
	const matured = () => {
		const start = press;
		if (!start || !current) return;
		node.classList.add("held");
		const move = (e: PointerEvent) => {
			if (e.pointerId !== start.pointerId || !movedPastSlop(start, e)) return;
			finish();
			current?.(e);
		};
		const end = (e: PointerEvent) => {
			if (e.pointerId === start.pointerId) finish();
		};
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", end);
		win.addEventListener("pointercancel", end);
		cleanup = () => {
			win.removeEventListener("pointermove", move);
			win.removeEventListener("pointerup", end);
			win.removeEventListener("pointercancel", end);
		};
	};
	const hold = longpress(node, {
		duration: 400,
		onLongpress: matured,
		ignore: (e) => pressOnControl(e.target),
	});
	node.addEventListener("pointerdown", down);
	return {
		update(next: OnGrab) {
			current = next;
		},
		destroy() {
			hold.destroy();
			node.removeEventListener("pointerdown", down);
			finish();
		},
	};
}
