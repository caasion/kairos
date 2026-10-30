import { describe, expect, it } from "vitest";
import { defaultPick, saveDayDrafts, saveDayItems } from "./saveDay";
import { addRoutine } from "./routinesWriter";
import { parseRoutines } from "./routinesFile";
import { applyRoutines } from "./apply";
import { parseRule, type Rule } from "./rules";
import { parseSchedule } from "../parser";

const rule = (text: string): Rule => parseRule(text)!;
const PATH = "2026-10-13 Tue.md";
const TUE = "2026-10-13";

const DAY = `## Schedule

- 12:30 - 13:30 Lunch
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
	- [x] Email Bob
- 09:00 - 11:00 Deep Work [Kairos]
	- [ ] Review PRs
	- [ ] Write spec [D:Admin]
- Unscheduled
	- [ ] Call home
`;

const day = () => parseSchedule(DAY, PATH);
const titles = (items: ReturnType<typeof saveDayItems>) => items.map((i) => i.block.title);

describe("saveDayItems", () => {
	it("lists the timed blocks by start time with their tasks, and leaves Unscheduled out", () => {
		const items = saveDayItems(day(), [], TUE);
		expect(titles(items)).toEqual(["Morning Routine", "Deep Work", "Lunch"]);
		expect(items[0]!.tasks.map((t) => t.task.text)).toEqual(["Take meds", "Email Bob"]);
		expect(items.every((i) => !i.saved && i.tasks.every((t) => !t.saved))).toBe(true);
	});

	it("marks blocks and tasks a routine due that day already makes", () => {
		const { routines } = parseRoutines(`## Weekdays
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
## Daily
- 12:00 - 13:00 Lunch
`);
		const items = saveDayItems(day(), routines, TUE);
		const [morning, deep, lunch] = items;
		expect(morning!.saved).toBe(true);
		expect(morning!.tasks.map((t) => t.saved)).toEqual([true, false]);
		expect(deep!.saved).toBe(false);
		// Lunch moved to another time on this day: still that routine (decision 61).
		expect(lunch!.saved).toBe(true);
	});

	it("ignores routines not due that day", () => {
		const { routines } = parseRoutines("## Mon, Wed\n- 12:30 - 13:30 Lunch\n");
		expect(saveDayItems(day(), routines, TUE).find((i) => i.block.title === "Lunch")!.saved).toBe(false);
	});

	it("counts repeats: one routine accounts for one of two same-titled blocks", () => {
		const blocks = parseSchedule(
			"## Schedule\n\n- 10:00 - 10:15 Buffer\n- 15:00 - 15:15 Buffer\n",
			PATH,
		);
		const { routines } = parseRoutines("## Daily\n- 15:00 - 15:15 Buffer\n");
		expect(saveDayItems(blocks, routines, TUE).map((i) => i.saved)).toEqual([false, true]);
	});

	it("matches a task by text and a compatible association", () => {
		const { routines } = parseRoutines(`## Daily
- [ ] Review PRs [Other]
- [ ] Write spec
`);
		const deep = saveDayItems(day(), routines, TUE).find((i) => i.block.title === "Deep Work")!;
		// Review PRs inherits [Kairos] from its block, which [Other] contradicts.
		expect(deep.tasks.map((t) => t.saved)).toEqual([false, true]);
	});
});

describe("saveDayDrafts", () => {
	it("writes the picked blocks, then their tasks nested under them", () => {
		const items = saveDayItems(day(), [], TUE);
		const pick = defaultPick(items);
		pick.tasks.delete(items[0]!.tasks[1]!.task); // leave out the one-off "Email Bob"
		pick.blocks.delete(items[2]!.block); // and Lunch
		const md = saveDayDrafts(items, pick, rule("tue")).reduce(addRoutine, "");
		expect(md).toBe(`## Tue
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
- 09:00 - 11:00 Deep Work [Kairos]
	- [ ] Review PRs
	- [ ] Write spec [D:Admin]
`);
	});

	it("never drafts what is already a routine, even if picked", () => {
		const { routines } = parseRoutines("## Daily\n- 12:30 - 13:30 Lunch\n");
		const items = saveDayItems(day(), routines, TUE);
		const pick = { blocks: new Set(items.map((i) => i.block)), tasks: new Set<never>() };
		expect(saveDayDrafts(items, pick, rule("tue")).map((d) => d.kind === "block" && d.title)).toEqual([
			"Morning Routine",
			"Deep Work",
		]);
	});

	it("homes a new task under a block that is already a routine", () => {
		const existing = "## Weekdays\n- 07:30 - 08:00 Morning Routine\n";
		const items = saveDayItems(day(), parseRoutines(existing).routines, TUE);
		const morning = items[0]!;
		const pick = { blocks: new Set([morning.block]), tasks: new Set([morning.tasks[0]!.task]) };
		const md = saveDayDrafts(items, pick, rule("tue")).reduce(addRoutine, existing);
		expect(md).toBe(`${existing}
## Tue
- Morning Routine
	- [ ] Take meds
`);
	});

	it("round-trips: applying the saved routines to an empty Tuesday gives the day back", () => {
		const items = saveDayItems(day(), [], TUE);
		const md = saveDayDrafts(items, defaultPick(items), rule("tue")).reduce(addRoutine, "");
		const { routines } = parseRoutines(md);
		const { blocks } = applyRoutines([], routines, TUE, PATH);
		const shape = (bs: typeof blocks) =>
			bs
				.filter((b) => b.time)
				.sort((a, b) => a.time!.start - b.time!.start)
				.map((b) => [b.title, b.time, b.tasks.map((t) => t.text)]);
		expect(shape(blocks)).toEqual(shape(day()));
		// And the saved day is now fully accounted for.
		expect(saveDayItems(day(), routines, TUE).every((i) => i.saved && i.tasks.every((t) => t.saved))).toBe(true);
	});
});
