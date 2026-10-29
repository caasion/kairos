// How a 0–5 intensity is drawn as three stacked bars (#73), filled from the
// bottom. An odd level lights a bar, and the even level above it dims the next
// one, so 1 lights the bottom bar, 2 adds a dim middle, and 5 lights all three.
// The stored scale stays 0–5; this is display only.

/** Bars in the stack. */
export const INTENSITY_BARS = 3;

/** One bar's state. */
export type BarFill = "off" | "dim" | "lit";

/** The level that lights `bar` (bar 0 is the bottom): 1, 3, 5. */
function litLevel(bar: number): number {
	return bar * 2 + 1;
}

/** Each bar's state for `level`, bottom bar first. Unset or 0 lights nothing. */
export function barFills(level: number | undefined): BarFill[] {
	const n = level ?? 0;
	return Array.from({ length: INTENSITY_BARS }, (_, bar) =>
		n >= litLevel(bar) ? "lit" : n === litLevel(bar) - 1 && bar > 0 ? "dim" : "off",
	);
}

/**
 * The level a click on `bar` sets from `current`: it lights the stack up to
 * that bar, and clicking the top lit bar again dims it (one level down). The
 * bottom bar has no dim step, so clicking it at 1 clears the level.
 */
export function levelAfterClick(current: number | undefined, bar: number): number | undefined {
	const lit = litLevel(bar);
	if (current !== lit) return lit;
	return bar === 0 ? undefined : lit - 1;
}
