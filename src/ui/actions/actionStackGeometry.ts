// Pure geometry for the vertical action stack (EXPERIMENT; the DOM side is
// actionStack.ts, driven by `actionZone` with `layout: "stack"`).
//
// The stack is one button wide. Its corner cell (the delete button on a task
// row) sits exactly where the horizontal bar's last button sat: in the row's
// top-right corner. The other buttons grow UP from there, so the stack covers
// only one button's width of the row's text. When there is no room above
// (top of the pane / of a scrolled list), it grows DOWN from the corner
// instead.

/** A screen rectangle (client coordinates). */
export interface Box {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export type StackDirection = "up" | "down";

export interface StackPlacement {
	/** Client-coordinate left/top of the stack's border box. */
	left: number;
	top: number;
	direction: StackDirection;
}

/**
 * Where to put a stack of `width` × `height` on `row`.
 *
 * - The stack's right edge is the row's right edge.
 * - Its corner cell is `width` tall (buttons are square, so the cell is as
 *   tall as the stack is wide) and its top is the row's top.
 * - "up": the stack's bottom is the corner cell's bottom, so it rises above
 *   the row. Chosen whenever it fits inside `bounds`.
 * - "down": the stack's top is the row's top, so it hangs below the corner.
 *   Chosen when "up" doesn't fit and "down" does.
 * - Neither fits (a tiny pane): the side with more room.
 */
export function placeActionStack(
	row: Pick<Box, "top" | "right">,
	width: number,
	height: number,
	bounds: Pick<Box, "top" | "bottom">,
): StackPlacement {
	const left = row.right - width;
	const upTop = row.top + width - height;
	const downTop = row.top;
	if (upTop >= bounds.top) return { left, top: upTop, direction: "up" };
	if (downTop + height <= bounds.bottom) return { left, top: downTop, direction: "down" };
	const roomUp = row.top + width - bounds.top;
	const roomDown = bounds.bottom - row.top;
	return roomUp >= roomDown
		? { left, top: upTop, direction: "up" }
		: { left, top: downTop, direction: "down" };
}

/** Intersection of two boxes (may be empty: bottom < top or right < left). */
export function intersectBoxes(a: Box, b: Box): Box {
	return {
		top: Math.max(a.top, b.top),
		right: Math.min(a.right, b.right),
		bottom: Math.min(a.bottom, b.bottom),
		left: Math.max(a.left, b.left),
	};
}

/** Whether `inner` lies within `outer`, give or take `slack` px. */
export function boxInside(inner: Box, outer: Box, slack = 0.5): boolean {
	return (
		inner.top >= outer.top - slack &&
		inner.left >= outer.left - slack &&
		inner.bottom <= outer.bottom + slack &&
		inner.right <= outer.right + slack
	);
}

/** The computed-style properties the checks below read. */
export type StyleLike = Pick<
	CSSStyleDeclaration,
	| "transform"
	| "filter"
	| "perspective"
	| "contain"
	| "willChange"
	| "containerType"
	| "overflowX"
	| "overflowY"
> & { backdropFilter?: string };

function set(value: string | undefined): boolean {
	return !!value && value !== "none" && value !== "normal" && value !== "auto";
}

/**
 * Whether an element with this computed style is the containing block of its
 * `position: fixed` descendants (so `fixed` is no longer viewport-relative).
 * See CSS Position 3 §3.1 / CSS Transforms / CSS Containment.
 */
export function formsFixedContainingBlock(style: StyleLike): boolean {
	if (set(style.transform) || set(style.filter) || set(style.perspective)) return true;
	if (set(style.backdropFilter)) return true;
	if (/\b(paint|layout|strict|content)\b/.test(style.contain ?? "")) return true;
	// Size container queries imply layout containment.
	if (set(style.containerType)) return true;
	return /\b(transform|filter|perspective|contain)\b/.test(style.willChange ?? "");
}

/** Whether an element with this computed style clips its descendants' paint. */
export function clipsDescendants(style: StyleLike): boolean {
	if (style.overflowX !== "visible" || style.overflowY !== "visible") return true;
	return /\b(paint|strict|content)\b/.test(style.contain ?? "");
}

/** Whether an element with this style is a scroll container (not merely clipped). */
export function scrolls(style: Pick<StyleLike, "overflowX" | "overflowY">): boolean {
	return /auto|scroll/.test(style.overflowY) || /auto|scroll/.test(style.overflowX);
}
