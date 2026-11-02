import { describe, expect, it } from "vitest";
import { barFills, levelAfterClick } from "./intensityBars";

describe("barFills", () => {
	it("lights nothing when unset or 0", () => {
		expect(barFills(undefined)).toEqual(["off", "off", "off"]);
		expect(barFills(0)).toEqual(["off", "off", "off"]);
	});

	it("lights a bar on odd levels and dims the next one on even levels", () => {
		expect(barFills(1)).toEqual(["lit", "off", "off"]);
		expect(barFills(2)).toEqual(["lit", "dim", "off"]);
		expect(barFills(3)).toEqual(["lit", "lit", "off"]);
		expect(barFills(4)).toEqual(["lit", "lit", "dim"]);
		expect(barFills(5)).toEqual(["lit", "lit", "lit"]);
	});
});

describe("levelAfterClick", () => {
	it("lights the stack up to the clicked bar", () => {
		expect(levelAfterClick(undefined, 0)).toBe(1);
		expect(levelAfterClick(undefined, 2)).toBe(5);
		expect(levelAfterClick(5, 1)).toBe(3);
		expect(levelAfterClick(2, 1)).toBe(3);
		expect(levelAfterClick(4, 2)).toBe(5);
	});

	it("dims the top lit bar when it's clicked again", () => {
		expect(levelAfterClick(3, 1)).toBe(2);
		expect(levelAfterClick(5, 2)).toBe(4);
	});

	it("clears the level when the bottom bar is clicked at 1", () => {
		expect(levelAfterClick(1, 0)).toBeUndefined();
	});

	it("reaches every level from 1 to 5", () => {
		const reached = new Set<number | undefined>();
		for (const from of [undefined, 0, 1, 2, 3, 4, 5]) {
			for (let bar = 0; bar < 3; bar++) reached.add(levelAfterClick(from, bar));
		}
		for (let level = 1; level <= 5; level++) expect(reached.has(level)).toBe(true);
	});
});
