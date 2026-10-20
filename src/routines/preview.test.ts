import { describe, expect, it } from "vitest";
import {
	listRoutines,
	missingRoutines,
	previewRoutines,
	routineKey,
	showsPreviews,
} from "./preview";
import { applyRoutines, routinesHash } from "./apply";
import { parseRoutines, type Routine } from "./routinesFile";
import { parseSchedule } from "../parser";

// 2026-10-07 Wed · 10-08 Thu · 10-12 Mon.
const WED = "2026-10-07";
const THU = "2026-10-08";
const MON = "2026-10-12";
const PATH = "day.md";

const FILE = `## Mon, Wed
- [ ] Noteworthy Rehearsal [Learning]
- 07:30 - 08:00 Morning Routine [D:Health]
	- [ ] Take meds
## Daily
- [ ] Water the plants
- Night Routine
	- [ ] Journal [D:Health]
`;
const { routines } = parseRoutines(FILE);
const blocksOf = (md: string) => parseSchedule(`## Schedule\n\n${md}\n`, PATH);
const names = (rs: Routine[]) => rs.map((r) => (r.kind === "block" ? r.title : r.text));

describe("missingRoutines", () => {
	it("lists everything due on an empty day", () => {
		expect(names(missingRoutines([], routines, MON))).toEqual([
			"Noteworthy Rehearsal",
			"Morning Routine",
			"Take meds",
			"Water the plants",
			"Journal",
		]);
	});

	it("lists only what's due that weekday", () => {
		expect(names(missingRoutines([], routines, THU))).toEqual(["Water the plants", "Journal"]);
	});

	it("drops what the day already has, whatever its status or block", () => {
		const day = blocksOf(
			"- 07:30 - 08:00 Morning Routine [D:Health]\n- 21:00 - 22:00 Wind down\n\t- [x] Water the plants",
		);
		expect(names(missingRoutines(day, routines, MON))).toEqual([
			"Noteworthy Rehearsal",
			"Take meds",
			"Journal",
		]);
	});

	it("doesn't list a block routine moved to another time", () => {
		const day = blocksOf("- 09:00 - 09:30 Morning Routine [D:Health]");
		expect(names(missingRoutines(day, routines, MON))).not.toContain("Morning Routine");
	});

	it("is empty once every routine has been applied", () => {
		const applied = applyRoutines([], routines, MON, PATH).blocks;
		expect(missingRoutines(applied, routines, MON)).toEqual([]);
	});
});

describe("showsPreviews: the visibility table", () => {
	const hash = routinesHash(routines, MON);

	it("never for a past day", () => {
		expect(showsPreviews({ date: WED, today: THU, routines })).toBe(false);
	});

	it("for today and future days that were never set up", () => {
		expect(showsPreviews({ date: THU, today: THU, routines })).toBe(true);
		expect(showsPreviews({ date: MON, today: THU, routines })).toBe(true);
	});

	it("not when the recorded hash matches — missing items were deleted on purpose", () => {
		expect(showsPreviews({ date: MON, today: THU, recorded: hash, routines })).toBe(false);
	});

	it("again when the routines changed since the day was set up", () => {
		expect(showsPreviews({ date: MON, today: THU, recorded: "old", routines })).toBe(true);
	});

	it("previewRoutines returns nothing for a set-up day even with items missing", () => {
		expect(
			previewRoutines({ date: MON, today: THU, recorded: hash, routines, blocks: [] }),
		).toEqual([]);
		expect(
			previewRoutines({ date: MON, today: THU, recorded: "old", routines, blocks: [] }),
		).toHaveLength(5);
	});
});

describe("listRoutines", () => {
	const titles = (list: ReturnType<typeof listRoutines>) => ({
		items: list.items.map((i) => [i.block?.title ?? null, ...i.tasks.map((t) => t.text)]),
		loose: list.loose.map((i) => i.tasks.map((t) => t.text)),
	});

	it("nests a block's tasks under it and adds them together; loose tasks go last", () => {
		const list = listRoutines(missingRoutines([], routines, MON));
		expect(titles(list)).toEqual({
			items: [
				["Morning Routine", "Take meds"],
				[null, "Journal"],
			],
			loose: [["Noteworthy Rehearsal"], ["Water the plants"]],
		});
		expect(list.items[0]!.routines.map((r) => r.kind)).toEqual(["block", "task"]);
		expect(list.count).toBe(5);
	});

	it("lists a task on its own when its block is already in the day", () => {
		const day = blocksOf("- 09:00 - 09:30 Morning Routine [D:Health]");
		const list = listRoutines(missingRoutines(day, routines, MON));
		expect(list.items[0]!.block).toBeUndefined();
		expect(list.items[0]!.tasks.map((t) => t.text)).toEqual(["Take meds"]);
	});

	it("orders blocks by start time, not file order", () => {
		const { routines: rs } = parseRoutines(
			"## Daily\n- 18:00 - 19:00 Gym\n- 07:00 - 07:30 Wake up\n",
		);
		expect(listRoutines(rs).items.map((i) => i.block?.title)).toEqual(["Wake up", "Gym"]);
	});

	it("gives every routine a distinct key", () => {
		const keys = routines.map(routineKey);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
