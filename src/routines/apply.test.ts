import { describe, expect, it } from "vitest";
import { applyRoutines, routinesHash, routinesStale } from "./apply";
import { parseRoutines } from "./routinesFile";
import type { Block } from "../types";

// 2026-10-05 is a Monday, 2026-10-06 a Tuesday, 2026-10-10 a Saturday.
const MON = "2026-10-05";
const TUE = "2026-10-06";
const SAT = "2026-10-10";
const PATH = "2026-10-05.md";

const FILE = `## Weekdays
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
- [ ] 18:00 - 19:00 Gym [Fitness] 🔁 Tue, Thu

## Daily
- [ ] Water the plants [D:Home]
- Night Routine [D:Health]
	- [ ] Journal
`;

const routines = parseRoutines(FILE).routines;

const titles = (blocks: Block[]) => blocks.map((b) => b.title);
const inbox = (blocks: Block[]) => blocks.find((b) => b.title === "Unscheduled");

describe("applyRoutines", () => {
	it("adds only the routines due that day", () => {
		const mon = applyRoutines([], routines, MON, PATH).blocks;
		expect(titles(mon)).toEqual(["Morning Routine", "Unscheduled"]);
		const tue = applyRoutines([], routines, TUE, PATH).blocks;
		expect(titles(tue)).toContain("Gym");
		const sat = applyRoutines([], routines, SAT, PATH).blocks;
		expect(titles(sat)).toEqual(["Unscheduled"]);
	});

	it("puts a homed task in the block made the same day", () => {
		const { blocks } = applyRoutines([], routines, MON, PATH);
		const morning = blocks.find((b) => b.title === "Morning Routine")!;
		expect(morning.tasks.map((t) => t.text)).toEqual(["Take meds"]);
	});

	it("falls back to Unscheduled when the home block isn't in the day", () => {
		const { blocks } = applyRoutines([], routines, MON, PATH);
		const journal = inbox(blocks)!.tasks.find((t) => t.text === "Journal")!;
		// The home's association is written, since Unscheduled has none to inherit.
		expect(journal.assoc).toEqual({ kind: "domain", id: "Health" });
	});

	it("homes a task in an existing block of that title without repeating its association", () => {
		const night: Block = {
			source: { path: PATH, line: 3 },
			title: "Night Routine",
			assoc: { kind: "domain", id: "Health" },
			scheduled: true,
			time: { start: 1350, end: 1380 },
			tasks: [],
		};
		const { blocks } = applyRoutines([night], routines, MON, PATH);
		const nightAfter = blocks.find((b) => b.title === "Night Routine")!;
		expect(nightAfter.tasks.map((t) => t.text)).toEqual(["Journal"]);
		expect(nightAfter.tasks[0]?.assoc).toBeUndefined();
	});

	it("is idempotent: a second run adds nothing", () => {
		const first = applyRoutines([], routines, TUE, PATH);
		const second = applyRoutines(first.blocks, routines, TUE, PATH);
		expect(second.added).toBe(0);
		expect(second.blocks).toBe(first.blocks);
	});

	it("skips a task already in the day, open (carried in) or done", () => {
		const day: Block[] = [
			{
				source: { path: PATH, line: 2 },
				title: "Unscheduled",
				scheduled: false,
				tasks: [
					{
						source: { path: PATH, line: 3 },
						text: "Water the plants",
						status: "x",
						assoc: { kind: "domain", id: "Home" },
					},
				],
			},
		];
		const { blocks } = applyRoutines(day, routines, SAT, PATH);
		expect(inbox(blocks)!.tasks.map((t) => t.text)).toEqual([
			"Water the plants",
			"Journal",
		]);
	});

	it("counts an untagged copy of a tagged routine task as present", () => {
		const day: Block[] = [
			{
				source: { path: PATH, line: 2 },
				title: "Unscheduled",
				scheduled: false,
				tasks: [{ source: { path: PATH, line: 3 }, text: "Water the plants", status: " " }],
			},
		];
		const { blocks } = applyRoutines(day, routines, SAT, PATH);
		expect(inbox(blocks)!.tasks.filter((t) => t.text === "Water the plants")).toHaveLength(1);
	});

	it("does not skip a task tagged with a different association", () => {
		const day: Block[] = [
			{
				source: { path: PATH, line: 2 },
				title: "Unscheduled",
				scheduled: false,
				tasks: [
					{
						source: { path: PATH, line: 3 },
						text: "Water the plants",
						status: " ",
						assoc: { kind: "domain", id: "Office" },
					},
				],
			},
		];
		const { blocks } = applyRoutines(day, routines, SAT, PATH);
		expect(inbox(blocks)!.tasks.filter((t) => t.text === "Water the plants")).toHaveLength(2);
	});

	it("skips a block with the same title at any time, so a moved one isn't added again", () => {
		const morning = (start: number): Block => ({
			source: { path: PATH, line: 2 },
			title: "Morning Routine",
			scheduled: true,
			time: { start, end: start + 30 },
			tasks: [],
		});
		const same = applyRoutines([morning(450)], routines, MON, PATH).blocks;
		expect(same.filter((b) => b.title === "Morning Routine")).toHaveLength(1);
		const moved = applyRoutines([morning(480)], routines, MON, PATH).blocks;
		expect(moved.filter((b) => b.title === "Morning Routine")).toHaveLength(1);
	});

	describe("repeated block titles", () => {
		const twice = parseRoutines(
			"## Daily\n- 09:00 - 11:00 Deep work\n- 14:00 - 16:00 Deep work\n",
		).routines;
		const deep = (start: number, line: number): Block => ({
			source: { path: PATH, line },
			title: "Deep work",
			scheduled: true,
			time: { start, end: start + 120 },
			tasks: [],
		});
		const times = (blocks: Block[]) =>
			blocks.filter((b) => b.title === "Deep work").map((b) => b.time!.start).sort((a, b) => a - b);

		it("needs one block per routine", () => {
			expect(times(applyRoutines([], twice, MON, PATH).blocks)).toEqual([540, 840]);
		});

		it("lets a block at a routine's own time account for that routine", () => {
			// 14:00 is already there, so only 09:00 is missing.
			expect(times(applyRoutines([deep(840, 1)], twice, MON, PATH).blocks)).toEqual([540, 840]);
		});

		it("pairs a moved block with the first routine left, and adds the rest", () => {
			// One Deep work at 10:00 stands in for 09:00; 14:00 is still missing.
			expect(times(applyRoutines([deep(600, 1)], twice, MON, PATH).blocks)).toEqual([600, 840]);
		});

		it("adds nothing when the day already has as many, wherever they sit", () => {
			const day = [deep(600, 1), deep(1020, 2)];
			expect(applyRoutines(day, twice, MON, PATH).added).toBe(0);
		});
	});

	it("makes a plain block from a timed routine line with a legacy checkbox", () => {
		const { blocks } = applyRoutines([], routines, TUE, PATH);
		const gym = blocks.find((b) => b.title === "Gym")!;
		expect(gym).not.toHaveProperty("status");
		expect(gym.tasks).toEqual([]);
		expect(gym.assoc).toEqual({ kind: "project", id: "Fitness" });
	});

	it("doesn't count a block of the same title as a task routine's copy", () => {
		// Only a task stands for a task routine; a block line never did once it
		// lost its checkbox.
		const block: Block = {
			source: { path: PATH, line: 3 },
			title: "Water the plants",
			assoc: { kind: "domain", id: "Home" },
			scheduled: true,
			time: { start: 600, end: 630 },
			tasks: [],
		};
		const { blocks } = applyRoutines([block], routines, SAT, PATH);
		expect(inbox(blocks)!.tasks.map((t) => t.text)).toContain("Water the plants");
	});
});

describe("routinesHash", () => {
	it("keeps the hash a plain block routine had before blocks lost their checkbox", () => {
		// Captured before the change: days that recorded it must not go stale.
		const plain = parseRoutines(`## Weekdays
- 07:30 - 08:00 Morning Routine [D:Health] (am)
	- [ ] Take meds
`).routines;
		expect(routinesHash(plain, MON)).toBe("h5iqjk");
	});

	it("keeps the hash a block routine with a leftover checkbox had", () => {
		// Captured before blocks lost their checkbox: days that recorded it must
		// not go stale until the routine is edited.
		const legacy = parseRoutines("## Daily\n- [ ] 18:00 - 19:00 Gym [Fitness]\n").routines;
		expect(routinesHash(legacy, MON)).toBe("6spcx4");
		const edited = parseRoutines("## Daily\n- 18:00 - 19:00 Gym [Fitness]\n").routines;
		expect(routinesHash(edited, MON)).not.toBe("6spcx4");
	});

	it("is stable for the same routines", () => {
		expect(routinesHash(routines, MON)).toBe(routinesHash(parseRoutines(FILE).routines, MON));
		expect(routinesHash(routines, MON)).toMatch(/^[0-9a-z]+$/);
	});

	it("ignores heading order and whitespace", () => {
		const reordered = `## Daily
- [ ] Water the plants   [D:Home]
- Night Routine [D:Health]
    - [ ] Journal

## Weekdays
- [ ] 18:00 - 19:00 Gym [Fitness] 🔁 Tue, Thu
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
`;
		expect(routinesHash(parseRoutines(reordered).routines, MON)).toBe(
			routinesHash(routines, MON),
		);
	});

	it("ignores an edit to a routine that doesn't occur that day", () => {
		const gymMoved = FILE.replace("18:00 - 19:00 Gym", "17:00 - 18:00 Gym");
		const edited = parseRoutines(gymMoved).routines;
		expect(routinesHash(edited, MON)).toBe(routinesHash(routines, MON));
		expect(routinesHash(edited, TUE)).not.toBe(routinesHash(routines, TUE));
	});

	it("changes when a routine due that day changes", () => {
		const renamed = parseRoutines(FILE.replace("Take meds", "Take vitamins")).routines;
		expect(routinesHash(renamed, MON)).not.toBe(routinesHash(routines, MON));
		const reassoc = parseRoutines(FILE.replace("[D:Home]", "[D:Garden]")).routines;
		expect(routinesHash(reassoc, SAT)).not.toBe(routinesHash(routines, SAT));
	});

	it("is empty when nothing is due", () => {
		expect(routinesHash(parseRoutines("## Sunday\n- [ ] Plan week\n").routines, MON)).toBe("");
	});
});

describe("routinesStale", () => {
	it("is false when nothing was recorded or the hash matches", () => {
		expect(routinesStale(undefined, routines, MON)).toBe(false);
		expect(routinesStale(routinesHash(routines, MON), routines, MON)).toBe(false);
	});

	it("is true when the recorded hash no longer matches", () => {
		const recorded = routinesHash(routines, MON);
		const edited = parseRoutines(FILE.replace("Take meds", "Take vitamins")).routines;
		expect(routinesStale(recorded, edited, MON)).toBe(true);
	});
});
