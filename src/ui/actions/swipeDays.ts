// A sideways swipe moves the Week view or the Grid one day (spec decision
// 139), as the arrows do. Touch only.
//
// Touch events, not pointer events: the browser takes a moving finger for a
// scroll and cancels its pointer, but its touch events keep coming.
//
// A swipe is quick, mostly sideways and long enough, and it doesn't start at
// a screen edge, where Obsidian opens its sidebars. A touch during which a drag
// was live is never a swipe: `busy` is checked as the finger moves.

const MIN_DISTANCE_PX = 48;
/** Sideways travel must be at least this many times the vertical travel. */
const MIN_RATIO = 2;
const MAX_DURATION_MS = 600;
/** A swipe starting this close to the screen's side is Obsidian's. */
const EDGE_PX = 24;

export interface SwipeDaysOptions {
	/** Move by `days` (+1 later, −1 earlier). */
	onSwipe: (days: number) => void;
	/** Whether a drag is live, so this touch isn't a swipe. */
	busy?: () => boolean;
}

export function swipeDays(node: HTMLElement, options: SwipeDaysOptions) {
	let opts = options;
	let start: { x: number; y: number; at: number } | null = null;
	const win = node.ownerDocument.defaultView ?? window;

	function onStart(e: TouchEvent) {
		const t = e.touches[0];
		const nearEdge = !t || t.clientX < EDGE_PX || t.clientX > win.innerWidth - EDGE_PX;
		start = e.touches.length === 1 && !nearEdge ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
		if (start && opts.busy?.()) start = null;
	}
	function onMove(e: TouchEvent) {
		if (e.touches.length > 1 || opts.busy?.()) start = null;
	}
	function onEnd(e: TouchEvent) {
		const from = start;
		start = null;
		const t = e.changedTouches[0];
		if (!from || !t) return;
		const dx = t.clientX - from.x;
		const dy = t.clientY - from.y;
		if (e.timeStamp - from.at > MAX_DURATION_MS) return;
		if (Math.abs(dx) < MIN_DISTANCE_PX || Math.abs(dx) < MIN_RATIO * Math.abs(dy)) return;
		// Finger to the left brings the later days in.
		opts.onSwipe(dx < 0 ? 1 : -1);
	}
	const cancel = () => {
		start = null;
	};

	node.addEventListener("touchstart", onStart, { passive: true });
	node.addEventListener("touchmove", onMove, { passive: true });
	node.addEventListener("touchend", onEnd);
	node.addEventListener("touchcancel", cancel);
	return {
		update(next: SwipeDaysOptions) {
			opts = next;
		},
		destroy() {
			node.removeEventListener("touchstart", onStart);
			node.removeEventListener("touchmove", onMove);
			node.removeEventListener("touchend", onEnd);
			node.removeEventListener("touchcancel", cancel);
		},
	};
}
