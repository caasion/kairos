// Scroll while dragging: a task or block drag that nears the edge of a view's
// scroll area scrolls it, faster the closer the pointer gets to the edge, so a
// drag can reach a block that's out of sight (a task from the Day view's
// Unscheduled list dropped on the 16:00 block, below the fold).
//
// Every drag in Kairos tracks the window pointer itself and hit-tests the DOM
// under it (see timeline/taskDrag.ts), so nothing here knows about drops. The
// drag owner starts one of these on grab, feeds it each pointer move, and stops
// it on release. Two things come back to it through `onScroll`:
//   • the scroll this module drives, and
//   • any other scroll during the drag (the wheel, a trackpad).
// Either moves the content under a pointer that didn't move, so the owner
// re-hit-tests at the last pointer position — the drop always matches what's
// under the pointer now, not where it was before the scroll.
//
// Which areas scroll: any element marked `data-drag-scroll` (the Day, Week and
// Grid scroll areas), whichever the pointer is over, so a drag that began in
// one view scrolls another view it's carried into.

export const DRAG_SCROLL_SELECTOR = "[data-drag-scroll]";

// The band along an edge where scrolling starts, and the speed at the edge
// itself (px per 16 ms frame). The band shrinks for a short area so its two
// bands never meet.
const EDGE_PX = 56;
const MAX_SPEED = 20;
const FRAME_MS = 16;

/**
 * The scroll speed (px per frame) for a pointer at `pos` on an axis spanning
 * `start`..`end`: negative within `zone` of the start, positive within `zone`
 * of the end, zero elsewhere (and outside the span). Rises with the square of
 * the depth into the band, so the first few pixels creep and the edge races.
 */
export function edgeSpeed(
	pos: number,
	start: number,
	end: number,
	zone = EDGE_PX,
	max = MAX_SPEED,
): number {
	if (pos < start || pos > end) return 0;
	const band = Math.min(zone, (end - start) / 4);
	if (band <= 0) return 0;
	const ramp = (depth: number) => max * Math.min(1, depth / band) ** 2;
	if (pos < start + band) return -ramp(start + band - pos);
	if (pos > end - band) return ramp(pos - (end - band));
	return 0;
}

/** The marked scroll area under a point, if it can scroll at all. */
function areaAt(doc: Document, x: number, y: number): HTMLElement | null {
	for (const el of Array.from(doc.querySelectorAll<HTMLElement>(DRAG_SCROLL_SELECTOR))) {
		if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) continue;
		const r = el.getBoundingClientRect();
		if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
	}
	return null;
}

export interface DragScroll {
	/** The pointer moved: remember where, for the edge check and re-hit-tests. */
	update(event: PointerEvent): void;
	/** The drag ended: stop scrolling and stop listening. */
	stop(): void;
}

/**
 * Start edge-scrolling for a drag that began with `first`. `onScroll` gets the
 * latest pointer event whenever anything scrolled during the drag.
 */
export function startDragScroll(
	first: PointerEvent,
	onScroll: (last: PointerEvent) => void,
): DragScroll {
	const doc = (first.target as Node | null)?.ownerDocument ?? document;
	const win = doc.defaultView ?? window;
	let last = first;
	let frame: number | undefined;
	let prev: number | undefined;

	const tick = (now: number) => {
		frame = undefined;
		const area = areaAt(doc, last.clientX, last.clientY);
		if (!area) {
			prev = undefined;
			return;
		}
		const r = area.getBoundingClientRect();
		const dy = edgeSpeed(last.clientY, r.top, r.bottom);
		const dx = edgeSpeed(last.clientX, r.left, r.right);
		if (dx === 0 && dy === 0) {
			prev = undefined;
			return;
		}
		// Scale by the real frame time so a slow frame doesn't slow the scroll.
		const scale = prev === undefined ? 1 : Math.min(4, (now - prev) / FRAME_MS);
		prev = now;
		area.scrollBy(dx * scale, dy * scale);
		frame = win.requestAnimationFrame(tick);
	};
	const schedule = () => {
		if (frame === undefined) frame = win.requestAnimationFrame(tick);
	};

	// Scroll doesn't bubble; capture sees every scroll in the document.
	const scrolled = () => onScroll(last);
	doc.addEventListener("scroll", scrolled, true);
	schedule();

	return {
		update(event) {
			last = event;
			schedule();
		},
		stop() {
			if (frame !== undefined) win.cancelAnimationFrame(frame);
			frame = undefined;
			doc.removeEventListener("scroll", scrolled, true);
		},
	};
}
