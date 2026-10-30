import { describe, expect, it } from "vitest";
import { coveredMinutes, formatDuration, routinesWeek } from "./routinesWeek";
import { parseRoutines, type BlockRoutine } from "./routinesFile";
import { weekdayName } from "./rules";

const FILE = `## Weekdays
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
- 12:30 - 13:30 Lunch

## Tue, Thu
- 12:00 - 13:00 Gym [Fitness]
	- [ ] Stretch

## Daily
- Unscheduled
	- [ ] Water the plants
- [ ] Journal 🔁 Mon
- Night Routine
	- [ ] Read

## Monthly on 1
- 09:00 - 10:00 Review finances
`;

const week = () => routinesWeek(parseRoutines(FILE).routines);
const titles = (bs: BlockRoutine[]) => bs.map((b) => b.title);

describe("routinesWeek", () => {
	it("is Monday to Sunday, each day holding the weekly blocks that repeat on it", () => {
		const w = week();
		expect(w.days.map((d) => weekdayName(d.day))).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
		expect(titles(w.days[0]!.blocks)).toEqual(["Morning Routine", "Lunch"]);
		expect(titles(w.days[1]!.blocks)).toEqual(["Morning Routine", "Gym", "Lunch"]);
		expect(w.days[5]!.blocks).toEqual([]);
	});

	it("marks blocks that overlap on a day, and only on that day", () => {
		const w = week();
		expect(titles([...w.days[1]!.overlaps])).toEqual(["Gym", "Lunch"]);
		expect(w.days[0]!.overlaps.size).toBe(0);
	});

	it("counts the time a day's blocks cover once, however they overlap", () => {
		const w = week();
		expect(w.days[0]!.minutes).toBe(90); // 30 + 60
		expect(w.days[1]!.minutes).toBe(120); // 30 + 12:00–13:30
		expect(w.days[6]!.minutes).toBe(0);
	});

	it("counts the tasks in each block on that day", () => {
		const tue = week().days[1]!;
		const gym = tue.blocks.find((b) => b.title === "Gym")!;
		const morning = tue.blocks.find((b) => b.title === "Morning Routine")!;
		expect(tue.taskCount.get(gym)).toBe(1);
		expect(tue.taskCount.get(morning)).toBe(1);
	});

	it("spans the hours the week's blocks use, leaving monthly ones out", () => {
		const w = week();
		expect([w.startHour, w.endHour]).toEqual([7, 14]);
	});

	it("counts what no weekday column can draw", () => {
		const w = week();
		// Water the plants, Journal, and Read (Night Routine has no timed block).
		expect(w.untimed).toBe(3);
		expect(w.monthly).toBe(1);
	});

	it("falls back to working hours with no blocks", () => {
		const w = routinesWeek([]);
		expect([w.startHour, w.endHour]).toEqual([8, 18]);
		expect(w.days.every((d) => d.blocks.length === 0)).toBe(true);
	});
});

describe("coveredMinutes", () => {
	const block = (start: number, end: number) => ({ time: { start, end } }) as BlockRoutine;
	it("adds separate blocks, merges overlapping and nested ones", () => {
		expect(coveredMinutes([block(0, 30), block(60, 90)])).toBe(60);
		expect(coveredMinutes([block(0, 60), block(30, 90)])).toBe(90);
		expect(coveredMinutes([block(0, 120), block(30, 60)])).toBe(120);
		expect(coveredMinutes([block(0, 60), block(60, 90)])).toBe(90);
	});
});

describe("formatDuration", () => {
	it("reads like a header", () => {
		expect([0, 45, 120, 390].map(formatDuration)).toEqual(["0m", "45m", "2h", "6h 30m"]);
	});
});
