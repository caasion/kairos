// Where on a row its hover action bar wakes up (pure geometry; the Svelte
// action that uses it is `actionZone.ts`).
//
// An action bar floats over the row's right end and covers the end of the
// row's text. Showing it on any hover made it pop up whenever the pointer
// merely crossed a row. Instead it wakes only inside a triangle against the
// row's right edge, reaching furthest left where the bar sits:
//
// - "top-right" (bar pinned to the top-right corner): a right triangle with
//   the right angle on the top-right corner. One leg runs left along the top
//   edge, the other down the right edge, so it tapers to nothing at the
//   bottom-right.
// - "right" (bar centred vertically on the right edge): an isosceles triangle
//   whose base is the whole right edge and whose apex points left at the row's
//   vertical middle, so it tapers to nothing at both right corners.
//
// The leg that runs left spans the rightmost `fraction` of the row, but never
// less than the bar's own width, so the bar is fully covered where the
// triangle is widest. Elsewhere the triangle narrows past the bar's left
// buttons; the caller keeps the bar shown while the pointer is over the bar
// itself, so those buttons stay reachable.

/** Share of the row's width, from the right edge, along the triangle's widest line. */
export const ACTION_EDGE_FRACTION = 0.2;

/** Where the bar sits on the row, and so where the triangle is widest. */
export type ActionZoneAnchor = "top-right" | "right";

/** The parts of a DOMRect the geometry needs. */
export interface ZoneRect {
	top: number;
	right: number;
	width: number;
	height: number;
}

/** Length (px) of the triangle's widest line for a row of `rowWidth` and a bar of `barWidth`. */
export function actionZoneWidth(
	rowWidth: number,
	barWidth: number,
	fraction = ACTION_EDGE_FRACTION,
): number {
	return Math.min(rowWidth, Math.max(rowWidth * fraction, barWidth));
}

/**
 * Whether a pointer at (`clientX`, `clientY`) is inside the row's action
 * triangle for the given `anchor` (see the header comment).
 */
export function inActionZone(
	clientX: number,
	clientY: number,
	row: ZoneRect,
	barWidth: number,
	fraction = ACTION_EDGE_FRACTION,
	anchor: ActionZoneAnchor = "top-right",
): boolean {
	const fromRight = row.right - clientX;
	const fromTop = clientY - row.top;
	if (fromRight < 0 || fromTop < 0 || fromTop > row.height || row.height <= 0) return false;
	const leg = actionZoneWidth(row.width, barWidth, fraction);
	if (leg <= 0) return false;
	if (anchor === "right") {
		const half = row.height / 2;
		return fromRight / leg + Math.abs(fromTop - half) / half <= 1;
	}
	return fromRight / leg + fromTop / row.height <= 1;
}
