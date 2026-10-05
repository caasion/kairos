// Where on a task row the hover action bar wakes up.
//
// The bar (association, nest, backlog, delete) floats over the row's top-right
// and covers the end of the task text. Showing it on any hover made it pop up
// whenever the pointer merely crossed a task. Instead it shows only while the
// pointer is near the row's right edge: within the rightmost `fraction` of the
// row, but never a zone narrower than the bar itself, so every button is
// inside the zone and can be reached without the bar vanishing on the way.

/** Share of the row's width, from the right edge, that wakes the bar. */
export const ACTION_EDGE_FRACTION = 0.2;

/** Width (px) of the right-edge zone for a row of `rowWidth` and a bar of `barWidth`. */
export function actionZoneWidth(
	rowWidth: number,
	barWidth: number,
	fraction = ACTION_EDGE_FRACTION,
): number {
	return Math.min(rowWidth, Math.max(rowWidth * fraction, barWidth));
}

/** Whether a pointer at `clientX` is inside the row's action zone. */
export function inActionZone(
	clientX: number,
	row: { right: number; width: number },
	barWidth: number,
	fraction = ACTION_EDGE_FRACTION,
): boolean {
	return clientX >= row.right - actionZoneWidth(row.width, barWidth, fraction);
}
