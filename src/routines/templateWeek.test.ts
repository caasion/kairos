import { describe, expect, it } from "vitest";
import { parseRoutines, type BlockRoutine } from "./routinesFile";
import { routineLink, tasksInBlock, templateWeek } from "./templateWeek";

const FILE = `## Weekdays
- 09:00 - 17:00 Work [D:Job]
\t- [ ] Standup
## Mon, Wed
- 18:30 - 20:30 Rehearsal [Noteworthy]
\t- [ ] Warm up
## Daily
- 07:15 - 07:45 Morning routine
- [ ] Water the plants
- Night routine
\t- [ ] Journal
## Monthly on 1
- [ ] Pay rent
`;
const { routines } = parseRoutines(FILE);
const week = templateWeek(routines);
const titles = (day: number) => week.days.find((d) => d.day === day)!.blocks.map((b) => b.title);

describe("templateWeek", () => {
	it("runs Monday to Sunday", () => {
		expect(week.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
	});

	it("puts each block on every weekday it repeats on, by start time", () => {
		expect(titles(1)).toEqual(["Morning routine", "Work", "Rehearsal"]);
		expect(titles(2)).toEqual(["Morning routine", "Work"]);
		expect(titles(6)).toEqual(["Morning routine"]);
	});

	it("spans the hours the blocks cover", () => {
		expect([week.startHour, week.endHour]).toEqual([7, 21]);
	});

	it("keeps tasks with no timed block, and monthly routines, off the grid", () => {
		expect(week.untimed.map((t) => t.text)).toEqual(["Water the plants", "Journal"]);
		expect(week.monthly.map((r) => (r.kind === "task" ? r.text : r.title))).toEqual(["Pay rent"]);
	});

	it("falls back to working hours with no blocks", () => {
		const empty = templateWeek([]);
		expect([empty.startHour, empty.endHour]).toEqual([8, 18]);
		expect(empty.days.every((d) => d.blocks.length === 0)).toBe(true);
	});

	it("counts the tasks in a block on a given day", () => {
		const work = routines.find((r): r is BlockRoutine => r.kind === "block" && r.title === "Work")!;
		expect(tasksInBlock(routines, work, 1)).toBe(1);
		expect(tasksInBlock(routines, work, 6)).toBe(0);
	});
});

describe("routineLink", () => {
	const link = routineLink(routines);
	const find = (name: string) =>
		routines.find((r) => (r.kind === "block" ? r.title : r.text) === name)!;

	it("links a block to itself and its tasks to it", () => {
		expect(link(find("Standup"))).toBe(link(find("Work")));
		expect(link(find("Warm up"))).toBe(link(find("Rehearsal")));
	});

	it("leaves a task with no timed block linked only to itself", () => {
		expect(link(find("Journal"))).toBe(find("Journal").line);
		expect(link(find("Water the plants"))).toBe(find("Water the plants").line);
	});
});
