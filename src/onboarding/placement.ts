// Where the tour's popover sits relative to what it points at. The Day view
// lives in the right sidebar, so the left side is tried first: it keeps the
// popover off the timeline the person is about to drag on. Pure, so it's tested
// without a DOM.

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export type Side = "left" | "right" | "below" | "above" | "corner";

export interface Placement {
	left: number;
	top: number;
	side: Side;
}

const clamp = (v: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * Place a popover of `size` next to `anchor` inside `viewport`, on the first
 * side it fits whole, clamped along the other axis so it never leaves the
 * window. With no anchor, or no side with room, it docks in the bottom-right
 * corner.
 */
export function placePopover(
	anchor: Rect | null,
	size: { width: number; height: number },
	viewport: { width: number; height: number },
	gap = 12,
): Placement {
	const m = 8;
	const corner: Placement = {
		left: Math.max(m, viewport.width - size.width - 16),
		top: Math.max(m, viewport.height - size.height - 16),
		side: "corner",
	};
	if (!anchor) return corner;

	const right = anchor.left + anchor.width;
	const bottom = anchor.top + anchor.height;
	const midY = anchor.top + anchor.height / 2 - size.height / 2;
	const midX = anchor.left + anchor.width / 2 - size.width / 2;
	const yAlong = clamp(midY, m, viewport.height - size.height - m);
	const xAlong = clamp(midX, m, viewport.width - size.width - m);

	if (anchor.left - gap - size.width >= m) {
		return { left: anchor.left - gap - size.width, top: yAlong, side: "left" };
	}
	if (right + gap + size.width <= viewport.width - m) {
		return { left: right + gap, top: yAlong, side: "right" };
	}
	if (bottom + gap + size.height <= viewport.height - m) {
		return { left: xAlong, top: bottom + gap, side: "below" };
	}
	if (anchor.top - gap - size.height >= m) {
		return { left: xAlong, top: anchor.top - gap - size.height, side: "above" };
	}
	return corner;
}

/** The part of `a` inside `b`, or null when they don't overlap. */
export function intersect(a: Rect, b: Rect): Rect | null {
	const left = Math.max(a.left, b.left);
	const top = Math.max(a.top, b.top);
	const r = Math.min(a.left + a.width, b.left + b.width);
	const btm = Math.min(a.top + a.height, b.top + b.height);
	if (r <= left || btm <= top) return null;
	return { left, top, width: r - left, height: btm - top };
}

/**
 * On a phone the card is a strip across the top of the visible view, just
 * under its header, never beside its anchor: there's no room beside anything,
 * and the keyboard pushes a floating card over what's being typed into. When
 * the anchor is up there under the strip, the strip moves to the bottom.
 * `area` is the part of the view that's on screen (the keyboard shrinks it).
 */
export function dockPopover(
	anchor: Rect | null,
	height: number,
	area: Rect,
	inset = 6,
): { left: number; top: number; width: number; side: "top" | "bottom" } {
	const left = area.left + inset;
	const width = Math.max(0, area.width - inset * 2);
	const top = area.top + inset;
	const covers = anchor !== null && anchor.top < top + height + inset && anchor.top + anchor.height > top;
	if (!covers) return { left, top, width, side: "top" };
	return { left, top: Math.max(top, area.top + area.height - height - inset), width, side: "bottom" };
}
