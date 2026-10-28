import { describe, expect, it } from "vitest";
import { barFills, levelAt } from "./intensityBars";

describe("barFills", () => {
	it("fills nothing when unset or 0", () => {
		expect(barFills(undefined)).toEqual([0, 0, 0]);
		expect(barFills(0)).toEqual([0, 0, 0]);
	});

	it("fills two levels a bar from the bottom, halving on odd levels", () => {
		expect(barFills(1)).toEqual([0.5, 0, 0]);
		expect(barFills(2)).toEqual([1, 0, 0]);
		expect(barFills(3)).toEqual([1, 0.5, 0]);
		expect(barFills(4)).toEqual([1, 1, 0]);
		expect(barFills(5)).toEqual([1, 1, 0.5]);
	});
});

describe("levelAt", () => {
	it("maps each bar's halves to its odd and even level", () => {
		expect(levelAt(0, "left")).toBe(1);
		expect(levelAt(0, "right")).toBe(2);
		expect(levelAt(1, "left")).toBe(3);
		expect(levelAt(1, "right")).toBe(4);
		expect(levelAt(2, "left")).toBe(5);
	});

	it("clamps the top bar's right half to 5", () => {
		expect(levelAt(2, "right")).toBe(5);
	});

	it("round-trips: the level a half sets fills up to that half", () => {
		for (let bar = 0; bar < 3; bar++) {
			for (const half of ["left", "right"] as const) {
				const fills = barFills(levelAt(bar, half));
				expect(fills[bar]).toBe(half === "left" || bar === 2 ? 0.5 : 1);
			}
		}
	});
});
