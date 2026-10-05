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
// edge (default "top-right"); `fraction` to widen/narrow the zone.
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

import { inActionZone, type ActionZoneAnchor } from "./actionZoneGeometry";

/** Class on the row while its action bar is awake (mouse in the zone). */
export const ACTIONS_AWAKE_CLASS = "kairos-actions-awake";
/** Class marking the row's action bar (a direct child of the row). */
export const ACTION_BAR_CLASS = "kairos-action-bar";

export interface ActionZoneOptions {
	/** Where the bar sits on the row (default "top-right"). */
	anchor?: ActionZoneAnchor;
	/** Share of the row's width the zone reaches along its widest line. */
	fraction?: number;
}

export function actionZone(host: HTMLElement, options: ActionZoneOptions = {}) {
	let opts = options;
	let awake = false;

	function setAwake(next: boolean) {
		if (next === awake) return;
		awake = next;
		host.classList.toggle(ACTIONS_AWAKE_CLASS, next);
	}

	function onMove(event: PointerEvent) {
		if (event.pointerType !== "mouse") return;
		// Looked up per event: the bar may render conditionally.
		const bar = host.querySelector<HTMLElement>(`:scope > .${ACTION_BAR_CLASS}`);
		// Once over the bar itself, keep it: the triangle narrows away from its
		// widest line, and the bar's left buttons must stay reachable.
		if (awake && bar && event.target && bar.contains(event.target as Node)) return;
		setAwake(
			inActionZone(
				event.clientX,
				event.clientY,
				host.getBoundingClientRect(),
				bar?.offsetWidth ?? 0,
				opts.fraction,
				opts.anchor,
			),
		);
	}

	function onLeave() {
		setAwake(false);
	}

	host.addEventListener("pointermove", onMove);
	host.addEventListener("pointerleave", onLeave);

	return {
		update(next: ActionZoneOptions = {}) {
			opts = next;
		},
		destroy() {
			host.removeEventListener("pointermove", onMove);
			host.removeEventListener("pointerleave", onLeave);
			host.classList.remove(ACTIONS_AWAKE_CLASS);
		},
	};
}
