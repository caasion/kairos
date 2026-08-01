import { describe, expect, it } from "vitest";
import { parseSchedule } from "./parser";
import { serialize } from "./serializer";
import type { Block } from "./types";

// Round-trips for the block/task states the day-view actions produce. The
// heading defaults to "## Schedule"; parseSchedule reads it back.
describe("serialize / parseSchedule round-trip", () => {
	it("round-trips a timed block converted to a task (has a checkbox)", () => {
		const block: Block = {
			source: { path: "x", line: -1 },
			title: "Deep work",
			status: " ",
			scheduled: true,
			time: { start: 540, end: 600 },
			tasks: [],
		};
		const md = serialize([block]);
		expect(md).toContain("- [ ] 09:00 - 10:00 Deep work");

		const back = parseSchedule(md, "x");
		expect(back).toHaveLength(1);
		expect(back[0]?.status).toBe(" ");
		expect(back[0]?.title).toBe("Deep work");
		expect(back[0]?.time).toEqual({ start: 540, end: 600 });
	});

	it("round-trips a checkable block that also has child tasks", () => {
		const block: Block = {
			source: { path: "x", line: -1 },
			title: "Deep work",
			status: "/",
			scheduled: true,
			time: { start: 540, end: 600 },
			tasks: [
				{ source: { path: "x", line: -2 }, text: "New task", status: " " },
			],
		};
		const md = serialize([block]);
		const back = parseSchedule(md, "x");
		expect(back[0]?.status).toBe("/");
		expect(back[0]?.tasks).toHaveLength(1);
		expect(back[0]?.tasks[0]?.text).toBe("New task");
	});

	it("round-trips a block with a freshly added child task", () => {
		const block: Block = {
			source: { path: "x", line: -1 },
			title: "Meeting",
			scheduled: true,
			time: { start: 600, end: 660 },
			tasks: [
				{ source: { path: "x", line: -2 }, text: "Agenda", status: " " },
			],
		};
		const md = serialize([block]);
		const back = parseSchedule(md, "x");
		// A plain (non-checkable) block stays statusless…
		expect(back[0]?.status).toBeUndefined();
		// …and its child task survives the round-trip.
		expect(back[0]?.tasks).toHaveLength(1);
		expect(back[0]?.tasks[0]?.text).toBe("Agenda");
	});
});
