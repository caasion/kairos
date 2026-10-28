// How a 0–5 intensity is drawn as three stacked bars (#73). Each bar holds two
// levels and the stack fills from the bottom, so an odd level half-fills its
// top bar. The stored scale stays 0–5; this is display only.

import { INTENSITY_MAX } from "../../projectFile";

/** Bars in the stack. */
export const INTENSITY_BARS = 3;

/** One bar's fill: empty, its left half, or whole. */
export type BarFill = 0 | 0.5 | 1;

/** Each bar's fill for `level`, bottom bar first. Unset or 0 fills nothing. */
export function barFills(level: number | undefined): BarFill[] {
	const n = level ?? 0;
	return Array.from({ length: INTENSITY_BARS }, (_, bar) => {
		const rest = n - bar * 2;
		return rest >= 2 ? 1 : rest === 1 ? 0.5 : 0;
	});
}

/**
 * The level a click on one half of a bar sets (bar 0 is the bottom): the left
 * half is the bar's odd level, the right half its even one. The top bar's right
 * half would be 6, so it clamps to the top of the scale.
 */
export function levelAt(bar: number, half: "left" | "right"): number {
	return Math.min(INTENSITY_MAX, bar * 2 + (half === "right" ? 2 : 1));
}
