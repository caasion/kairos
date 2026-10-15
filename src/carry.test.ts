import { describe, expect, it } from "vitest";
import { carryOver, previousDay } from "./carry";
import { parseSchedule } from "./parser";
import type { Block, Day } from "./types";

function day(path: string): Block[] {
	return [
		{
			source: { path, line: 2 },
			title: "Deep work",
			assoc: { kind: "project", id: "Kairos" },
			scheduled: true,
			time: { start: 540, end: 600 },
			tasks: [
				{ source: { path, line: 3 }, text: "Open", status: " " },
				{ source: { path, line: 4 }, text: "Done", status: "x" },
				{ source: { path, line: 5 }, text: "Half", status: "/" },
				{ source: { path, line: 6 }, text: "Cancelled", status: "-" },
				{
					source: { path, line: 7 },
					text: "Own assoc",
					status: " ",
					assoc: { kind: "domain", id: "Admin" },
				},
			],
		},
		{
			source: { path, line: 9 },
			title: "Unscheduled",
			scheduled: false,
			tasks: [{ source: { path, line: 10 }, text: "Loose", status: " " }],
		},
	];
}

describe("carryOver", () => {
	it("moves open and half-done tasks, leaves done and cancelled", () => {
		const { from, to, moved } = carryOver(day("mon.md"), [], "tue.md");
		expect(moved).toBe(4);
		expect(from[0]?.tasks.map((t) => t.text)).toEqual(["Done", "Cancelled"]);
		expect(from[1]?.tasks).toEqual([]);
		const inbox = to.find((b) => b.title === "Unscheduled")!;
		expect(inbox.tasks.map((t) => t.text)).toEqual([
			"Open",
			"Half",
			"Own assoc",
			"Loose",
		]);
		expect(inbox.tasks.every((t) => t.source.path === "tue.md")).toBe(true);
		expect(inbox.tasks.find((t) => t.text === "Half")?.status).toBe("/");
	});

	it("never carries blocks", () => {
		const { from, to } = carryOver(day("mon.md"), [], "tue.md");
		expect(from[0]?.title).toBe("Deep work");
		expect(from[0]?.time).toEqual({ start: 540, end: 600 });
		expect(to.map((b) => b.title)).toEqual(["Unscheduled"]);
	});

	it("carries the task read from a legacy checkbox block line", () => {
		const blocks = parseSchedule("## Schedule\n\n- [ ] 18:00 - 19:00 Gym [Fitness]\n", "mon.md");
		const { from, to, moved } = carryOver(blocks, [], "tue.md");
		expect(moved).toBe(1);
		expect(from[0]?.title).toBe("Gym");
		expect(from[0]?.tasks).toEqual([]);
		const gym = to.find((b) => b.title === "Unscheduled")!.tasks[0]!;
		expect(gym).toMatchObject({ text: "Gym", status: " ", assoc: { kind: "project", id: "Fitness" } });
	});

	it("materializes an inherited association and keeps an explicit one", () => {
		const { to } = carryOver(day("mon.md"), [], "tue.md");
		const tasks = to[0]!.tasks;
		expect(tasks.find((t) => t.text === "Open")?.assoc).toEqual({
			kind: "project",
			id: "Kairos",
		});
		expect(tasks.find((t) => t.text === "Own assoc")?.assoc).toEqual({
			kind: "domain",
			id: "Admin",
		});
		expect(tasks.find((t) => t.text === "Loose")?.assoc).toBeUndefined();
	});

	it("appends to the target's existing Unscheduled list", () => {
		const target: Block[] = [
			{
				source: { path: "tue.md", line: 2 },
				title: "Unscheduled",
				scheduled: false,
				tasks: [
					{ source: { path: "tue.md", line: 3 }, text: "Already", status: " " },
				],
			},
		];
		const { to } = carryOver(day("mon.md"), target, "tue.md");
		expect(to).toHaveLength(1);
		expect(to[0]?.tasks[0]?.text).toBe("Already");
		expect(to[0]?.tasks).toHaveLength(5);
	});

	it("returns the inputs untouched when nothing carries", () => {
		const done: Block[] = [
			{
				source: { path: "mon.md", line: 2 },
				title: "Unscheduled",
				scheduled: false,
				tasks: [{ source: { path: "mon.md", line: 3 }, text: "x", status: "x" }],
			},
		];
		const target: Block[] = [];
		const r = carryOver(done, target, "tue.md");
		expect(r.moved).toBe(0);
		expect(r.from).toBe(done);
		expect(r.to).toBe(target);
	});
});

describe("previousDay", () => {
	const mk = (date: string): Day => ({
		date,
		path: `${date}.md`,
		mtime: 0,
		blocks: [],
	});
	const days = new Map([
		["2026-10-01", mk("2026-10-01")],
		["2026-10-03", mk("2026-10-03")],
		["2026-10-06", mk("2026-10-06")],
	]);

	it("looks back to the most recent earlier note, across gaps", () => {
		expect(previousDay(days, "2026-10-05")?.date).toBe("2026-10-03");
	});

	it("never returns the day itself or a later one", () => {
		expect(previousDay(days, "2026-10-03")?.date).toBe("2026-10-01");
		expect(previousDay(days, "2026-10-01")).toBeUndefined();
	});
});
