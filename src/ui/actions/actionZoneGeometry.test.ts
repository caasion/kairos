import { describe, expect, it } from "vitest";
import { actionZoneWidth, inActionZone } from "./actionZoneGeometry";

describe("actionZoneWidth", () => {
	it("is the rightmost 20% of a wide row", () => {
		expect(actionZoneWidth(600, 90)).toBe(120);
	});

	it("never shrinks below the bar, so the bar is covered along the top edge", () => {
		expect(actionZoneWidth(200, 90)).toBe(90);
	});

	it("never exceeds the row", () => {
		expect(actionZoneWidth(70, 90)).toBe(70);
	});

	it("honours a custom fraction", () => {
		expect(actionZoneWidth(600, 90, 0.5)).toBe(300);
	});
});

describe("inActionZone (top-right triangle)", () => {
	// A 600×40 row at (100, 200)–(700, 240): the top leg is 120px (x ≥ 580 on
	// the top edge) and the right leg is the full 40px height.
	const row = { top: 200, right: 700, width: 600, height: 40 };

	it("covers the top edge out to the leg's length", () => {
		expect(inActionZone(580, 200, row, 90)).toBe(true);
		expect(inActionZone(699, 200, row, 90)).toBe(true);
		expect(inActionZone(579, 200, row, 90)).toBe(false);
	});

	it("narrows linearly toward the bottom-right corner", () => {
		// Halfway down, the triangle is half as wide: x ≥ 640.
		expect(inActionZone(640, 220, row, 90)).toBe(true);
		expect(inActionZone(639, 220, row, 90)).toBe(false);
	});

	it("tapers to the corner at the bottom edge", () => {
		expect(inActionZone(700, 240, row, 90)).toBe(true);
		expect(inActionZone(690, 240, row, 90)).toBe(false);
	});

	it("is false over the start and middle of the row", () => {
		expect(inActionZone(120, 205, row, 90)).toBe(false);
		expect(inActionZone(400, 205, row, 90)).toBe(false);
	});

	it("is false outside the row", () => {
		expect(inActionZone(710, 205, row, 90)).toBe(false);
		expect(inActionZone(690, 195, row, 90)).toBe(false);
	});
});

describe("inActionZone (right-edge triangle, bar centred vertically)", () => {
	// Same 600×40 row: widest (120px, x ≥ 580) at the vertical middle y = 220,
	// tapering to the right corners at the top and bottom edges.
	const row = { top: 200, right: 700, width: 600, height: 40 };
	const at = (x: number, y: number) => inActionZone(x, y, row, 90, undefined, "right");

	it("is widest across the vertical middle", () => {
		expect(at(580, 220)).toBe(true);
		expect(at(579, 220)).toBe(false);
	});

	it("narrows symmetrically toward the top and bottom", () => {
		// A quarter of the height from the middle: half as wide, x ≥ 640.
		expect(at(640, 210)).toBe(true);
		expect(at(640, 230)).toBe(true);
		expect(at(639, 210)).toBe(false);
		expect(at(639, 230)).toBe(false);
	});

	it("tapers to the corners", () => {
		expect(at(700, 200)).toBe(true);
		expect(at(690, 200)).toBe(false);
		expect(at(690, 240)).toBe(false);
	});

	it("is false outside the row", () => {
		expect(at(690, 241)).toBe(false);
		expect(at(701, 220)).toBe(false);
	});
});
