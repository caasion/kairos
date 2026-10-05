// A Svelte action that wakes a row's hover action bar only when the mouse is
// in a triangle at the row's right edge (geometry in actionZoneGeometry.ts),
// not on any hover. Every hover-revealed action bar in the plugin uses it, so
// they all behave and look the same.
//
// Usage — put the action on the row and the shared class on its bar, which
// must be a DIRECT child of the row (so a nested row's bar, e.g. a task inside
// a timeline block, never wakes with its parent):
//
//   <div class="row" use:actionZone>
//     <div class="kairos-action-bar">…buttons…</div>
//     …
//   </div>
//
// Options: `{ anchor: "right" }` for a bar centred vertically on the right
// edge (default "top-right"); `fraction` to widen/narrow the zone;
// `layout: "stack"` (EXPERIMENT, task rows only) to show the bar as a vertical
// stack one button wide, rising from the row's top-right corner — see
// actionStack.ts.
//
// What it does (styles live in the global styles.css):
// - While the mouse is in the zone, the row carries `kairos-actions-awake`
//   (ACTIONS_AWAKE_CLASS), which shows its direct-child `.kairos-action-bar`.
//   Other selectors may key off that class to know the row's bar is up.
// - Hysteresis: once awake, the bar stays shown while the pointer is over the
//   bar itself, since the triangle narrows past the bar's left buttons.
// - Hidden bars are `pointer-events: none`, so a click on the end of the row's
//   text reaches the text, not an invisible button. They stay focusable, and
//   `:focus-within` shows the bar for keyboard users.
// - Mouse only. Touch has no pointer position to track; there the styles keep
//   showing the bar on the row's (sticky) `:hover` after a tap
//   (`@media (hover: none)`).

import { ActionStack } from "./actionStack";
import { inActionZone, type ActionZoneAnchor } from "./actionZoneGeometry";

/** Class on the row while its action bar is awake (mouse in the zone). */
export const ACTIONS_AWAKE_CLASS = "kairos-actions-awake";
/** Class marking the row's action bar (a direct child of the row). */
export const ACTION_BAR_CLASS = "kairos-action-bar";
/**
 * Class on the bar itself while awake, in the stack layout only: a portaled
 * stack is no longer the row's child, so `.kairos-actions-awake > …` can't
 * reach it.
 */
export const ACTION_BAR_AWAKE_CLASS = "kairos-action-bar-awake";

/**
 * Stack layout: how long the stack stays up after the pointer leaves both the
 * row and the stack, so crossing a sub-pixel gap between them doesn't drop it.
 */
const STACK_GRACE_MS = 120;
/** Stack layout: wait for the fade-out before un-portaling (styles.css 0.1s). */
const STACK_FADE_MS = 150;

export interface ActionZoneOptions {
	/** Where the bar sits on the row (default "top-right"). */
	anchor?: ActionZoneAnchor;
	/** Share of the row's width the zone reaches along its widest line. */
	fraction?: number;
	/**
	 * "bar" (default): the bar's own CSS lays it out. "stack" (EXPERIMENT): a
	 * vertical stack, one button wide, whose first button by CSS `order` sits in
	 * the row's top-right corner and the rest rise above it (or hang below when
	 * there's no room above). Mouse wakes only; touch keeps the bar's CSS.
	 */
	layout?: "bar" | "stack";
}

export function actionZone(host: HTMLElement, options: ActionZoneOptions = {}) {
	let opts = options;
	let awake = false;
	let stack: ActionStack | null = null;
	let sleepTimer: number | undefined;
	let restoreTimer: number | undefined;
	let viewportListening = false;
	let destroyed = false;
	// The row's own window (Obsidian pop-out windows have their own).
	const win: Window = host.ownerDocument.defaultView ?? activeWindow;

	const isStack = () => opts.layout === "stack";

	function findBar(): HTMLElement | null {
		// A portaled stack isn't the row's child any more.
		if (stack?.portaled) return stack.bar;
		// Looked up per event: the bar may render conditionally.
		return host.querySelector<HTMLElement>(`:scope > .${ACTION_BAR_CLASS}`);
	}

	function stackFor(bar: HTMLElement): ActionStack {
		if (stack?.bar !== bar) {
			stack?.destroy();
			stack = new ActionStack(host, bar, onBarEnter, onBarLeave);
		}
		return stack;
	}

	function clearTimers() {
		win.clearTimeout(sleepTimer);
		win.clearTimeout(restoreTimer);
		sleepTimer = restoreTimer = undefined;
	}

	function setAwake(next: boolean) {
		if (next === awake) return;
		awake = next;
		host.classList.toggle(ACTIONS_AWAKE_CLASS, next);
		if (!isStack()) return;
		const bar = findBar();
		if (next) {
			clearTimers();
			if (bar) stackFor(bar).place(true);
		} else if (stack?.portaled) {
			const s = stack;
			restoreTimer = win.setTimeout(() => {
				if (!awake) s.restore();
			}, STACK_FADE_MS);
		}
		bar?.classList.toggle(ACTION_BAR_AWAKE_CLASS, next);
		syncViewportListeners();
	}

	function sleepSoon() {
		win.clearTimeout(sleepTimer);
		sleepTimer = win.setTimeout(() => setAwake(false), STACK_GRACE_MS);
	}

	function onMove(event: PointerEvent) {
		if (event.pointerType !== "mouse") return;
		win.clearTimeout(sleepTimer);
		const bar = findBar();
		// Once over the bar itself, keep it: the triangle narrows away from its
		// widest line, and the bar's left buttons must stay reachable.
		if (awake && bar && event.target && bar.contains(event.target as Node)) return;
		// The zone's widest line covers at least the bar: its full width as a
		// horizontal bar, one button cell (its short side) as a stack.
		const barWidth = !bar ? 0 : isStack() ? Math.min(bar.offsetWidth, bar.offsetHeight) : bar.offsetWidth;
		setAwake(
			inActionZone(
				event.clientX,
				event.clientY,
				host.getBoundingClientRect(),
				barWidth,
				opts.fraction,
				opts.anchor,
			),
		);
	}

	function onLeave(event: PointerEvent) {
		if (!isStack()) {
			setAwake(false);
			return;
		}
		// Onto the portaled stack: it keeps itself up (onBarEnter/onBarLeave).
		const to = event.relatedTarget as Node | null;
		if (stack?.portaled && to && stack.bar.contains(to)) return;
		sleepSoon();
	}

	// Pointer over a portaled stack (not the row's descendant, so the row's own
	// listeners don't see it). ActionStack attaches these to the bar only while
	// it is portaled.
	function onBarEnter(event: PointerEvent) {
		if (event.pointerType === "mouse") win.clearTimeout(sleepTimer);
	}
	function onBarLeave(event: PointerEvent) {
		if (event.pointerType !== "mouse") return;
		const to = event.relatedTarget as Node | null;
		// Back onto the row: its pointermove decides.
		if (to && host.contains(to)) return;
		sleepSoon();
	}

	// Keyboard: `:focus-within` shows the bar; lay it out as a stack in place
	// (never portaled — see actionStack.ts).
	function onFocusIn(event: FocusEvent) {
		if (!isStack()) return;
		const bar = findBar();
		if (!bar || !bar.contains(event.target as Node)) return;
		if (!stack?.portaled) stackFor(bar).place(false);
		syncViewportListeners();
	}
	function onFocusOut() {
		// Focus has not moved yet during focusout; check once it has.
		win.setTimeout(syncViewportListeners, 0);
	}

	// While the stack is up, a scroll or resize would leave it floating over the
	// wrong spot. Hide it (mouse), or re-place it in place (keyboard focus).
	function onViewportChange() {
		const bar = findBar();
		const focused = !!bar && bar.contains(host.ownerDocument.activeElement);
		if (awake) setAwake(false);
		if (focused && bar && !stack?.portaled) stackFor(bar).place(false);
		syncViewportListeners();
	}

	function syncViewportListeners() {
		const bar = findBar();
		const want =
			!destroyed &&
			isStack() &&
			(awake || (!!bar && bar.contains(host.ownerDocument.activeElement)));
		if (want === viewportListening) return;
		viewportListening = want;
		if (want) {
			win.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
			win.addEventListener("resize", onViewportChange);
		} else {
			win.removeEventListener("scroll", onViewportChange, { capture: true });
			win.removeEventListener("resize", onViewportChange);
		}
	}

	host.addEventListener("pointermove", onMove);
	host.addEventListener("pointerleave", onLeave);
	host.addEventListener("focusin", onFocusIn);
	host.addEventListener("focusout", onFocusOut);

	return {
		update(next: ActionZoneOptions = {}) {
			const wasStack = isStack();
			opts = next;
			if (wasStack && !isStack()) {
				stack?.destroy();
				stack = null;
			}
			syncViewportListeners();
		},
		destroy() {
			destroyed = true;
			clearTimers();
			host.removeEventListener("pointermove", onMove);
			host.removeEventListener("pointerleave", onLeave);
			host.removeEventListener("focusin", onFocusIn);
			host.removeEventListener("focusout", onFocusOut);
			if (viewportListening) {
				win.removeEventListener("scroll", onViewportChange, { capture: true });
				win.removeEventListener("resize", onViewportChange);
				viewportListening = false;
			}
			host.classList.remove(ACTIONS_AWAKE_CLASS);
			stack?.bar.classList.remove(ACTION_BAR_AWAKE_CLASS);
			stack?.destroy();
			stack = null;
		},
	};
}
