// A Svelte action that fires a `longpress` CustomEvent after the pointer has
// been held on the node for `duration` ms without moving off it. Ported from
// Holos, updated to Pointer Events (one code path for mouse + touch) and to
// suppress the click that would otherwise follow the press.
//
// Usage:
//   <button use:longpress={500} onlongpresscapture={...}>…</button>
// or listen for the raw event:
//   node.addEventListener("longpress", handler)

export function longpress(node: HTMLElement, duration = 500) {
	let timer: number | undefined;
	let fired = false;

	function start() {
		fired = false;
		timer = window.setTimeout(() => {
			fired = true;
			node.dispatchEvent(new CustomEvent("longpress"));
		}, duration);
	}

	function cancel() {
		if (timer !== undefined) {
			window.clearTimeout(timer);
			timer = undefined;
		}
	}

	// If the long-press fired, swallow the trailing click so a press-to-cancel
	// isn't also read as a click-to-cycle.
	function onClick(event: MouseEvent) {
		if (fired) {
			event.stopImmediatePropagation();
			event.preventDefault();
			fired = false;
		}
	}

	node.addEventListener("pointerdown", start);
	node.addEventListener("pointerup", cancel);
	node.addEventListener("pointerleave", cancel);
	node.addEventListener("pointercancel", cancel);
	node.addEventListener("click", onClick, true);

	return {
		update(next: number) {
			duration = next;
		},
		destroy() {
			cancel();
			node.removeEventListener("pointerdown", start);
			node.removeEventListener("pointerup", cancel);
			node.removeEventListener("pointerleave", cancel);
			node.removeEventListener("pointercancel", cancel);
			node.removeEventListener("click", onClick, true);
		},
	};
}
