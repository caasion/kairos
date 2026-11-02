import { describe, expect, it } from "vitest";
import {
	applySaveDayPlan,
	defaultPick,
	overlapsOf,
	planCounts,
	repeatAll,
	saveDayItems,
	saveDayPlan,
	type SaveDayBlock,
} from "./saveDay";
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
		expect(items.every((i) => !i.routine && i.tasks.every((t) => !t.saved))).toBe(true);
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
		expect(morning!.routine?.title).toBe("Morning Routine");
		expect(morning!.moved).toBe(false);
		expect(morning!.tasks.map((t) => t.saved)).toEqual([true, false]);
		expect(deep!.routine).toBeUndefined();
		// Lunch moved to another time on this day: still that routine (decision 61), moved.
		expect(lunch!.routine?.title).toBe("Lunch");
		expect(lunch!.moved).toBe(true);
	});

	it("ignores routines not due that day", () => {
		const { routines } = parseRoutines("## Mon, Wed\n- 12:30 - 13:30 Lunch\n");
		const lunch = saveDayItems(day(), routines, TUE).find((i) => i.block.title === "Lunch")!;
		expect(lunch.routine).toBeUndefined();
	});

	it("counts repeats: one routine accounts for one of two same-titled blocks", () => {
		const blocks = parseSchedule(
			"## Schedule\n\n- 10:00 - 10:15 Buffer\n- 15:00 - 15:15 Buffer\n",
			PATH,
		);
		const { routines } = parseRoutines("## Daily\n- 15:00 - 15:15 Buffer\n");
		expect(saveDayItems(blocks, routines, TUE).map((i) => i.routine !== undefined)).toEqual([false, true]);
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


const save = (existing: string, items: SaveDayBlock[], pick = defaultPick(items, rule("tue"))) =>
	applySaveDayPlan(existing, saveDayPlan(items, pick));
const itemsFor = (existing: string, md = DAY, date = TUE) =>
	saveDayItems(parseSchedule(md, PATH), parseRoutines(existing).routines, date);
const byTitle = (items: SaveDayBlock[], title: string) => items.find((i) => i.block.title === title)!;

describe("saveDayPlan", () => {
	it("writes the picked blocks, then their tasks nested under them", () => {
		const items = saveDayItems(day(), [], TUE);
		const pick = defaultPick(items, rule("tue"));
		pick.tasks.delete(items[0]!.tasks[1]!.task); // leave out the one-off "Email Bob"
		pick.blocks.delete(items[2]!.block); // and Lunch
		expect(save("", items, pick)).toBe(`## Tue
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
- 09:00 - 11:00 Deep Work [Kairos]
	- [ ] Review PRs
	- [ ] Write spec [D:Admin]
`);
	});

	it("gives each block its own rule, and its tasks follow it", () => {
		const items = saveDayItems(day(), [], TUE);
		const pick = defaultPick(items, rule("tue"));
		pick.rules.set(byTitle(items, "Deep Work").block, rule("tue, thu"));
		pick.rules.set(byTitle(items, "Lunch").block, rule("daily"));
		expect(save("", items, pick)).toBe(`## Tue
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
	- [ ] Email Bob

## Tue, Thu
- 09:00 - 11:00 Deep Work [Kairos]
	- [ ] Review PRs
	- [ ] Write spec [D:Admin]

## Daily
- 12:30 - 13:30 Lunch
`);
	});

	it("Repeat all sets every row, and only adds days to a routine it saves onto", () => {
		const existing = "## Mon, Wed\n- 12:30 - 13:30 Lunch\n";
		const items = itemsFor(existing);
		const pick = defaultPick(items, rule("tue"));
		const rules = repeatAll(items, pick, rule("thu"));
		expect(rules.get(byTitle(items, "Deep Work").block)).toEqual(rule("thu"));
		expect(rules.get(byTitle(items, "Lunch").block)).toEqual(rule("mon, wed, thu"));
	});

	it("never writes a block a routine due that day already has, and adds new tasks on its rule", () => {
		const existing = "## Weekdays\n- 07:30 - 08:00 Morning Routine\n";
		const items = itemsFor(existing);
		const pick = defaultPick(items, rule("tue"));
		pick.blocks = new Set(items.map((i) => i.block)); // even if checked
		pick.tasks = new Set([items[0]!.tasks[0]!.task]);
		pick.blocks.delete(byTitle(items, "Deep Work").block);
		pick.blocks.delete(byTitle(items, "Lunch").block);
		expect(save(existing, items, pick)).toBe(`## Weekdays
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
`);
	});

	it("offers moving a routine the day has at another time, unchecked", () => {
		const existing = "## Daily\n- 12:00 - 13:00 Lunch\n";
		const items = itemsFor(existing);
		const lunch = byTitle(items, "Lunch");
		const pick = defaultPick(items, rule("tue"));
		expect(pick.blocks.has(lunch.block)).toBe(false);
		pick.blocks = new Set([lunch.block]);
		pick.tasks.clear();
		expect(save(existing, items, pick)).toBe("## Daily\n- 12:30 - 13:30 Lunch\n");
	});

	it("adds the day to a routine of the same title and time instead of a second line", () => {
		const existing = "## Mon, Wed\n- 12:30 - 13:30 Lunch\n\t- [ ] Walk\n";
		const items = itemsFor(existing);
		const lunch = byTitle(items, "Lunch");
		expect(lunch.extends?.title).toBe("Lunch");
		const pick = defaultPick(items, rule("tue"));
		expect(pick.rules.get(lunch.block)).toEqual(rule("mon, tue, wed"));
		pick.blocks = new Set([lunch.block]);
		pick.tasks.clear();
		expect(planCounts(saveDayPlan(items, pick))).toEqual({ added: 0, updated: 1 });
		expect(save(existing, items, pick)).toBe("## Mon, Tue, Wed\n- 12:30 - 13:30 Lunch\n\t- [ ] Walk\n");
	});

	it("adds a block with the same title at another time as its own routine, and says so", () => {
		const existing = "## Mon, Wed\n- 18:00 - 19:00 Lunch\n";
		const lunch = byTitle(itemsFor(existing), "Lunch");
		expect(lunch.extends).toBeUndefined();
		expect(lunch.alsoAt.map((r) => r.time.start)).toEqual([18 * 60]);
	});

	it("can replace a routine missing from the day whose time a new block took", () => {
		const existing = "## Daily\n- 12:00 - 13:00 Gym\n\t- [ ] Stretch\n";
		const items = itemsFor(existing);
		const lunch = byTitle(items, "Lunch");
		expect(lunch.replaces?.title).toBe("Gym");
		const pick = defaultPick(items, rule("tue"));
		expect(pick.replace.size).toBe(0); // adding is the default
		pick.blocks = new Set([lunch.block]);
		pick.tasks.clear();
		pick.replace.add(lunch.block);
		pick.rules = repeatAll(items, pick, rule("tue"));
		expect(save(existing, items, pick)).toBe("## Daily\n- 12:30 - 13:30 Lunch\n\t- [ ] Stretch\n");
	});

	it("adds the day to a task routine not due that day", () => {
		const existing = "## Mon\n- Deep Work\n\t- [ ] Review PRs\n";
		const items = itemsFor(existing);
		const deep = byTitle(items, "Deep Work");
		expect(deep.tasks[0]!.extends?.text).toBe("Review PRs");
		const pick = defaultPick(items, rule("tue"));
		pick.blocks = new Set();
		pick.tasks = new Set([deep.tasks[0]!.task]);
		expect(save(existing, items, pick)).toBe("## Mon, Tue\n- Deep Work\n\t- [ ] Review PRs\n");
	});

	it("doesn't extend a task its block's routine already brought along", () => {
		const existing = "## Mon\n- 09:00 - 11:00 Deep Work [Kairos]\n\t- [ ] Review PRs\n";
		const items = itemsFor(existing);
		const deep = byTitle(items, "Deep Work");
		const pick = defaultPick(items, rule("tue"));
		pick.blocks = new Set([deep.block]);
		pick.tasks = new Set([deep.tasks[0]!.task]);
		expect(save(existing, items, pick)).toBe(
			"## Mon, Tue\n- 09:00 - 11:00 Deep Work [Kairos]\n\t- [ ] Review PRs\n",
		);
	});

	it("round-trips: applying the saved routines to an empty Tuesday gives the day back", () => {
		const items = saveDayItems(day(), [], TUE);
		const { routines } = parseRoutines(save("", items));
		const { blocks } = applyRoutines([], routines, TUE, PATH);
		const shape = (bs: typeof blocks) =>
			bs
				.filter((b) => b.time)
				.sort((a, b) => a.time!.start - b.time!.start)
				.map((b) => [b.title, b.time, b.tasks.map((t) => t.text)]);
		expect(shape(blocks)).toEqual(shape(day()));
		// And the saved day is now fully accounted for.
		expect(saveDayItems(day(), routines, TUE).every((i) => i.routine && i.tasks.every((t) => t.saved))).toBe(true);
	});
});

describe("overlapsOf", () => {
	it("lists routines the row would share time with, on the days both cover", () => {
		const existing = "## Thu\n- 12:00 - 13:00 Reading\n## Daily\n- 12:30 - 13:30 Lunch\n";
		const { routines } = parseRoutines(existing);
		const items = saveDayItems(day(), routines, TUE);
		const deep = byTitle(items, "Deep Work");
		expect(overlapsOf(deep, rule("tue, thu"), routines, false)).toEqual([]);
		// Lunch is its own routine; Reading overlaps it on Thu only.
		const lunch = byTitle(items, "Lunch");
		const found = overlapsOf(lunch, rule("tue, thu"), routines, false);
		expect(found.map((o) => [o.routine.title, o.days])).toEqual([["Reading", [4]]]);
	});
});
