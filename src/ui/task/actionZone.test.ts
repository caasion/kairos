import { describe, expect, it } from "vitest";
import { actionZoneWidth, inActionZone } from "./actionZone";

describe("actionZoneWidth", () => {
	it("is the rightmost 20% of a wide row", () => {
		expect(actionZoneWidth(600, 90)).toBe(120);
	});

	it("never shrinks below the bar, so every button sits inside it", () => {
		expect(actionZoneWidth(200, 90)).toBe(90);
	});

	it("never exceeds the row", () => {
		expect(actionZoneWidth(70, 90)).toBe(70);
	});

	it("honours a custom fraction", () => {
		expect(actionZoneWidth(600, 90, 0.5)).toBe(300);
	});
});

describe("inActionZone", () => {
	// A 600px row from x=100 to x=700: the zone is x >= 580.
	const row = { right: 700, width: 600 };

	it("is false over the start and middle of the row", () => {
		expect(inActionZone(120, row, 90)).toBe(false);
		expect(inActionZone(400, row, 90)).toBe(false);
		expect(inActionZone(579, row, 90)).toBe(false);
	});

	it("is true near the right edge", () => {
		expect(inActionZone(580, row, 90)).toBe(true);
		expect(inActionZone(699, row, 90)).toBe(true);
	});
});
