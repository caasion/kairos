import { describe, expect, it } from "vitest";
import type { Block } from "../../types";
import { incomingBlock } from "./taskDrag";

const block: Block = {
	source: { path: "Daily/2026-11-03.md", line: 4 },
	title: "Thesis writing",
	tasks: [],
	scheduled: true,
	time: { start: 540, end: 660 },
};

describe("incomingBlock: a Week block move previewed on the day it lands (#71)", () => {
	const time = { start: 600, end: 720 };

	it("names the day under the pointer, the block's title and the time it keeps", () => {
		expect(incomingBlock("2026-11-03", "2026-11-04", block, time)).toEqual({
			date: "2026-11-04",
			label: "Thesis writing",
			time,
		});
	});

	it("is null over the block's own day, where the block itself moves", () => {
		expect(incomingBlock("2026-11-03", "2026-11-03", block, time)).toBeNull();
	});

	it("is null off every column, or before the move has a time", () => {
		expect(incomingBlock("2026-11-03", null, block, time)).toBeNull();
		expect(incomingBlock("2026-11-03", "2026-11-04", block, null)).toBeNull();
	});
});
