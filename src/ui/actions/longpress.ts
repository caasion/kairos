// A Svelte action that fires a `longpress` CustomEvent after the pointer has
// been held on the node for `duration` ms without moving off it. Ported from
// Holos, updated to Pointer Events (one code path for mouse + touch) and to
// suppress the click that would otherwise follow the press.
//
// Usage:
//   <button use:longpress={500} onlongpresscapture={...}>…</button>
// or listen for the raw event:
//   node.addEventListener("longpress", handler)
//
// Because Svelte's typed DOM attributes don't cover custom events, callers that
// prefer a direct callback (no `addEventListener` plumbing) can pass options:
//   <button use:longpress={{ duration: 450, onLongpress: () => … }}>…</button>

interface LongpressOptions {
	duration?: number;
	/** Called when the press matures — an alternative to listening for the event. */
	onLongpress?: () => void;
}

type LongpressParam = number | LongpressOptions;

function normalize(param: LongpressParam): Required<LongpressOptions> {
	if (typeof param === "number") return { duration: param, onLongpress: () => {} };
	return { duration: param.duration ?? 500, onLongpress: param.onLongpress ?? (() => {}) };
}

export function longpress(node: HTMLElement, param: LongpressParam = 500) {
	let { duration, onLongpress } = normalize(param);
	let timer: number | undefined;
	let fired = false;

	function start() {
		fired = false;
		timer = window.setTimeout(() => {
			fired = true;
			node.dispatchEvent(new CustomEvent("longpress"));
			onLongpress();
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
		update(next: LongpressParam) {
			({ duration, onLongpress } = normalize(next));
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
