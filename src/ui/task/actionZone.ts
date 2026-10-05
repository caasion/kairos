// Where on a task row the hover action bar wakes up.
//
// The bar (association, nest, backlog, delete) floats over the row's top-right
// and covers the end of the task text. Showing it on any hover made it pop up
// whenever the pointer merely crossed a task. Instead it wakes only inside a
// right triangle anchored at the row's top-right corner — the right angle sits
// on that corner, one leg runs left along the top edge, the other down the
// right edge — so it reaches furthest along the top, where the bar sits, and
// tapers to nothing at the bottom-right.
//
// The top leg spans the rightmost `fraction` of the row, but never less than
// the bar's own width, so the bar is fully covered where it starts. Below the
// top edge the triangle narrows past the bar's left buttons; the caller keeps
// the bar shown while the pointer is over the bar itself, so those buttons stay
// reachable.

/** Share of the row's width, from the right edge, along the triangle's top leg. */
export const ACTION_EDGE_FRACTION = 0.2;

/** Length (px) of the triangle's top leg for a row of `rowWidth` and a bar of `barWidth`. */
export function actionZoneWidth(
	rowWidth: number,
	barWidth: number,
	fraction = ACTION_EDGE_FRACTION,
): number {
	return Math.min(rowWidth, Math.max(rowWidth * fraction, barWidth));
}

/**
 * Whether a pointer at (`clientX`, `clientY`) is inside the row's action
 * triangle: right angle on the top-right corner, top leg `actionZoneWidth`
 * long, right leg the row's full height.
 */
export function inActionZone(
	clientX: number,
	clientY: number,
	row: { top: number; right: number; width: number; height: number },
	barWidth: number,
	fraction = ACTION_EDGE_FRACTION,
): boolean {
	const fromRight = row.right - clientX;
	const fromTop = clientY - row.top;
	if (fromRight < 0 || fromTop < 0 || row.height <= 0) return false;
	const leg = actionZoneWidth(row.width, barWidth, fraction);
	if (leg <= 0) return false;
	return fromRight / leg + fromTop / row.height <= 1;
}
