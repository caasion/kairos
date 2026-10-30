import { describe, expect, it } from "vitest";
import { applyRoutines, routinesFor } from "./apply";
import { parseRoutines } from "./routinesFile";
import { applyRegenerate, checkedByDefault, regenerateChanges } from "./regenerate";
import type { Block } from "../types";

// 2026-10-05 is a Monday.
const MON = "2026-10-05";
const PATH = "2026-10-05.md";

const OLD = `## Weekdays
- 07:30 - 08:00 Morning Routine [Health]
	- [ ] Take meds
	- [ ] Stretch [Fitness]
- 09:00 - 12:00 Deep work [Kairos]

## Daily
- [ ] Water the plants [D:Home]
`;

const due = (md: string) => routinesFor(parseRoutines(md).routines, MON);
/** A day set up from `md`, as applying would leave it. */
const dayFrom = (md: string) => applyRoutines([], due(md), MON, PATH).blocks;
const find = (blocks: Block[], title: string) => blocks.find((b) => b.title === title)!;

describe("regenerateChanges", () => {
	it("finds nothing when the day matches its routines", () => {
		const old = dayFrom(OLD);
		expect(regenerateChanges(old, due(OLD))).toEqual([]);
	});

	it("offers a block's new association, and its inheriting tasks follow", () => {
		const old = dayFrom(OLD);
		const next = OLD.replace("Morning Routine [Health]", "Morning Routine [Wellbeing]");
		const changes = regenerateChanges(old, due(next));
		expect(changes.map((c) => c.kind)).toEqual(["assoc"]);
		const c = changes[0]!;
		expect(c.kind === "assoc" && [c.from?.id, c.to?.id]).toEqual(["Health", "Wellbeing"]);

		const after = applyRegenerate(old, changes, PATH);
		const morning = find(after, "Morning Routine");
		expect(morning.assoc).toEqual({ kind: "project", id: "Wellbeing" });
		// "Take meds" inherits; nothing is written on it.
		expect(morning.tasks.find((t) => t.text === "Take meds")!.assoc).toBeUndefined();
		expect(regenerateChanges(after, due(next))).toEqual([]);
	});

	it("updates a task's own association instead of adding a second copy", () => {
		const old = dayFrom(OLD);
		const next = OLD.replace("Stretch [Fitness]", "Stretch [Mobility]");
		const changes = regenerateChanges(old, due(next));
		expect(changes.map((c) => c.kind)).toEqual(["task-assoc"]);
		const after = applyRegenerate(old, changes, PATH);
		const tasks = find(after, "Morning Routine").tasks.filter((t) => t.text === "Stretch");
		expect(tasks).toHaveLength(1);
		expect(tasks[0]!.assoc).toEqual({ kind: "project", id: "Mobility" });
	});

	it("keeps a task's status and the tasks the user added", () => {
		const old = dayFrom(OLD);
		const day = old.map((b) =>
			b.title === "Morning Routine"
				? {
						...b,
						tasks: [
							...b.tasks.map((t) => (t.text === "Take meds" ? { ...t, status: "x" as const } : t)),
							{ source: { path: PATH, line: 99 }, text: "Call mum", status: " " as const },
						],
					}
				: b,
		);
		const next = OLD.replace("Morning Routine [Health]", "Morning Routine [Wellbeing]").replace(
			"Stretch [Fitness]",
			"Stretch [Mobility]",
		);
		const after = applyRegenerate(day, regenerateChanges(day, due(next)), PATH);
		const morning = find(after, "Morning Routine");
		expect(morning.tasks.map((t) => [t.text, t.status])).toEqual([
			["Take meds", "x"],
			["Stretch", " "],
			["Call mum", " "],
		]);
	});

	it("offers a task missing from its block, and a routine missing from the day", () => {
		const old = dayFrom(OLD);
		const next = OLD.replace("\t- [ ] Stretch [Fitness]\n", "\t- [ ] Stretch [Fitness]\n\t- [ ] Floss\n") +
			"- 21:00 - 21:30 Read\n";
		const changes = regenerateChanges(old, due(next));
		expect(changes.map((c) => c.kind).sort()).toEqual(["missing", "task"]);
		const after = applyRegenerate(old, changes, PATH);
		expect(find(after, "Morning Routine").tasks.map((t) => t.text)).toContain("Floss");
		expect(find(after, "Read").time).toEqual({ start: 21 * 60, end: 21 * 60 + 30 });
	});

	it("offers a moved block's time, unchecked by default, and moves it only when picked", () => {
		const old = dayFrom(OLD);
		const day = old.map((b) =>
			b.title === "Deep work" ? { ...b, time: { start: 13 * 60, end: 16 * 60 } } : b,
		);
		const changes = regenerateChanges(day, due(OLD));
		expect(changes.map((c) => c.kind)).toEqual(["time"]);
		expect(checkedByDefault("time")).toBe(false);
		expect(checkedByDefault("assoc")).toBe(true);
		expect(applyRegenerate(day, [], PATH)).toEqual(day);
		const moved = applyRegenerate(day, changes, PATH);
		expect(find(moved, "Deep work").time).toEqual({ start: 9 * 60, end: 12 * 60 });
	});

	it("changes only the picked changes", () => {
		const old = dayFrom(OLD);
		const next = OLD.replace("Morning Routine [Health]", "Morning Routine [Wellbeing]").replace(
			"Deep work [Kairos]",
			"Deep work [Writing]",
		);
		const changes = regenerateChanges(old, due(next));
		const deep = changes.filter((c) => c.kind === "assoc" && c.routine.title === "Deep work");
		const after = applyRegenerate(old, deep, PATH);
		expect(find(after, "Morning Routine").assoc).toEqual({ kind: "project", id: "Health" });
		expect(find(after, "Deep work").assoc).toEqual({ kind: "project", id: "Writing" });
	});

	it("drops a block's association when the routine no longer has one", () => {
		const old = dayFrom(OLD);
		const next = OLD.replace("Deep work [Kairos]", "Deep work");
		const changes = regenerateChanges(old, due(next));
		const after = applyRegenerate(old, changes, PATH);
		expect("assoc" in find(after, "Deep work")).toBe(false);
	});

	it("gives each change a stable key", () => {
		const old = dayFrom(OLD);
		const next = OLD.replace("Deep work [Kairos]", "Deep work [Writing]");
		const a = regenerateChanges(old, due(next)).map((c) => c.key);
		const b = regenerateChanges(old, due(next)).map((c) => c.key);
		expect(a).toEqual(b);
		expect(new Set(a).size).toBe(a.length);
	});
});
