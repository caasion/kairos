import { describe, expect, it } from "vitest";
import { parseSchedule } from "./parser";
import { serialize } from "./serializer";
import type { Block } from "./types";

// Round-trips for the block/task states the day-view actions produce. The
// heading defaults to "## Schedule"; parseSchedule reads it back.
describe("serialize / parseSchedule round-trip", () => {
	it("round-trips a block that ends at midnight", () => {
		const block: Block = {
			source: { path: "x", line: -1 },
			title: "Sleep",
			scheduled: true,
			time: { start: 1380, end: 1440 },
			tasks: [],
		};
		const md = serialize([block]);
		expect(md).toContain("- 23:00 - 24:00 Sleep");

		const back = parseSchedule(md, "x");
		expect(back).toHaveLength(1);
		expect(back[0]?.scheduled).toBe(true);
		expect(back[0]?.title).toBe("Sleep");
		expect(back[0]?.time).toEqual({ start: 1380, end: 1440 });
	});

	it("never writes a checkbox on a block line", () => {
		const block: Block = {
			source: { path: "x", line: -1 },
			title: "Deep work",
			scheduled: true,
			time: { start: 540, end: 600 },
			tasks: [{ source: { path: "x", line: -2 }, text: "Draft", status: "x" }],
		};
		expect(serialize([block])).toBe("## Schedule\n\n- 09:00 - 10:00 Deep work\n\t- [x] Draft\n");
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
		// The child task survives the round-trip.
		expect(back[0]?.tasks).toHaveLength(1);
		expect(back[0]?.tasks[0]?.text).toBe("Agenda");
	});
});

describe("notes: bullets without a checkbox under a block", () => {
	const md = [
		"## Schedule",
		"",
		"- 12:00 - 13:00 Lunch",
		"\t- Ran into Sam, talked about the [[Origin]] pitch",
		"\t- [ ] Book the room",
		"\t- Ate outside (sunny)",
		"\t- [x] Pay back Ana",
		"",
	].join("\n");

	it("reads them as notes, verbatim, not as open tasks", () => {
		const [lunch] = parseSchedule(md, "x");
		expect(lunch?.tasks.map((t) => t.text)).toEqual(["Book the room", "Pay back Ana"]);
		expect(lunch?.notes).toEqual([
			{ text: "Ran into Sam, talked about the [[Origin]] pitch", at: 0 },
			{ text: "Ate outside (sunny)", at: 1 },
		]);
	});

	it("writes them back where they were, between the tasks", () => {
		expect(serialize(parseSchedule(md, "x"))).toBe(md);
	});

	it("puts a note past the last task at the end", () => {
		const block: Block = {
			source: { path: "x", line: -1 },
			title: "Rehearsal",
			scheduled: true,
			time: { start: 1140, end: 1260 },
			tasks: [],
			notes: [{ text: "Ran the second act twice", at: 3 }],
		};
		expect(serialize([block])).toContain("- 19:00 - 21:00 Rehearsal\n\t- Ran the second act twice\n");
	});
});

// A legacy checkbox block line ("- [x] 07:00 - 08:00 Gym") is read as a block
// holding a task; the next write splits it into the two-line form. An untimed
// one is a task in Unscheduled, and is written there.
describe("legacy checkbox block lines", () => {
	const legacy = [
		"## Schedule",
		"",
		"- [x] 07:00 - 08:00 Gym [Fitness] (legs)",
		"\t- Felt strong",
		"\t- [ ] Stretch",
		"- [ ] Buy milk",
		"",
	].join("\n");
	const twoLine = [
		"## Schedule",
		"",
		"- 07:00 - 08:00 Gym [Fitness] (legs)",
		"\t- [x] Gym",
		"\t- Felt strong",
		"\t- [ ] Stretch",
		"- Unscheduled",
		"\t- [ ] Buy milk",
		"",
	].join("\n");

	// Structure only: lines are re-derived from the text.
	const shape = (blocks: Block[]) =>
		blocks.map(({ source: _s, tasks, ...b }) => ({ ...b, tasks: tasks.map(({ source: _t, ...t }) => t) }));

	it("writes the block and its task on two lines", () => {
		expect(serialize(parseSchedule(legacy, "x"))).toBe(twoLine);
	});

	it("reads the two-line form back as the same structure, and stays put", () => {
		const first = parseSchedule(legacy, "x");
		const second = parseSchedule(serialize(first), "x");
		expect(shape(second)).toEqual(shape(first));
		expect(serialize(second)).toBe(twoLine);
	});
});
