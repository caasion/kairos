import { describe, expect, it } from "vitest";
import { edgeSpeed } from "./dragScroll";

describe("edgeSpeed", () => {
	// A 600px area from 100 to 700, a 50px band, 20px/frame at the edge.
	const speed = (pos: number) => edgeSpeed(pos, 100, 700, 50, 20);

	it("doesn't scroll away from the edges", () => {
		expect(speed(400)).toBe(0);
		expect(speed(150)).toBe(0);
		expect(speed(650)).toBe(0);
	});

	it("scrolls up near the top and down near the bottom", () => {
		expect(speed(120)).toBeLessThan(0);
		expect(speed(680)).toBeGreaterThan(0);
	});

	it("speeds up toward the edge, reaching the maximum at it", () => {
		expect(speed(690)).toBeGreaterThan(speed(670));
		expect(speed(700)).toBe(20);
		expect(speed(100)).toBe(-20);
		// Squared ramp: halfway into the band is a quarter of the speed.
		expect(speed(675)).toBeCloseTo(5);
	});

	it("doesn't scroll for a pointer outside the area", () => {
		expect(speed(99)).toBe(0);
		expect(speed(701)).toBe(0);
	});

	it("narrows the band in a short area so the two never meet", () => {
		// 80px tall → 20px bands; the middle stays still.
		expect(edgeSpeed(140, 100, 180, 50, 20)).toBe(0);
		expect(edgeSpeed(105, 100, 180, 50, 20)).toBeLessThan(0);
	});
});
