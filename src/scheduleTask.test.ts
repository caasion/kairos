// The writer primitives behind dragging a task onto a timeline from another
// view: into a block on another day, or onto empty time (a new block).

import { describe, expect, it } from "vitest";
import {
	blockForTask,
	copyTaskIntoBlock,
	copyTaskIntoNewBlock,
	moveTaskIntoBlockAcrossDays,
	scheduleTaskInNewBlock,
	scheduleTaskInNewBlockAcrossDays,
} from "./writer";
import type { Block, Task } from "./types";

const TWO_PM = { start: 840, end: 870 };

// Wednesday: a Kairos block holding an inheriting task, and Unscheduled holding
// an explicitly-tagged one.
function wednesday(): Block[] {
	return [
		{
			source: { path: "wed.md", line: 3 },
			title: "Kairos",
			assoc: { kind: "project", id: "Kairos" },
			scheduled: true,
			time: { start: 660, end: 720 },
			tasks: [{ source: { path: "wed.md", line: 4 }, text: "Fix carry bug", status: " " }],
		},
		{
			source: { path: "wed.md", line: 6 },
			title: "Unscheduled",
			scheduled: false,
			tasks: [
				{
					source: { path: "wed.md", line: 7 },
					text: "Launch post",
					status: "/",
					assoc: { kind: "project", id: "Kairos" },
					metadata: "p1",
				},
				{ source: { path: "wed.md", line: 8 }, text: "Groceries", status: " " },
			],
		},
	];
}

// Thursday: a Deep work block on a domain, with one task.
function thursday(): Block[] {
	return [
		{
			source: { path: "thu.md", line: 3 },
			title: "Deep work",
			assoc: { kind: "domain", id: "Writing" },
			scheduled: true,
			time: { start: 540, end: 630 },
			tasks: [{ source: { path: "thu.md", line: 4 }, text: "Outline", status: " " }],
		},
	];
}

const inbox = (blocks: Block[]) => blocks.find((b) => b.title === "Unscheduled")!;
const launch = (blocks: Block[]): Task => inbox(blocks).tasks[0]!;
const fixBug = (blocks: Block[]): Task => blocks[0]!.tasks[0]!;

describe("moveTaskIntoBlockAcrossDays", () => {
	it("moves the task into the block at the slot and out of its day", () => {
		const wed = wednesday();
		const thu = thursday();
		const { from, to } = moveTaskIntoBlockAcrossDays(
			wed, thu, inbox(wed), launch(wed), thu[0]!, "thu.md", 0,
		);
		expect(inbox(from).tasks.map((t) => t.text)).toEqual(["Groceries"]);
		expect(to[0]!.tasks.map((t) => t.text)).toEqual(["Launch post", "Outline"]);
		expect(to[0]!.tasks[0]!.source.path).toBe("thu.md");
		expect(to[0]!.tasks[0]!.source.line).toBeLessThan(0);
	});

	it("writes an inherited association onto the task so its owner survives", () => {
		const wed = wednesday();
		const thu = thursday();
		const { to } = moveTaskIntoBlockAcrossDays(
			wed, thu, wed[0]!, fixBug(wed), thu[0]!, "thu.md",
		);
		const moved = to[0]!.tasks.at(-1)!;
		expect(moved.text).toBe("Fix carry bug");
		expect(moved.assoc).toEqual({ kind: "project", id: "Kairos" });
	});

	it("is a no-op when the destination isn't on the target day", () => {
		const wed = wednesday();
		const thu = thursday();
		const res = moveTaskIntoBlockAcrossDays(
			wed, thu, inbox(wed), launch(wed), wed[0]!, "thu.md",
		);
		expect(res.from).toBe(wed);
		expect(res.to).toBe(thu);
	});

	it("won't lift a checkable block's own checkbox", () => {
		const block: Block = {
			source: { path: "wed.md", line: 2 },
			title: "Run",
			status: " ",
			scheduled: true,
			time: { start: 420, end: 450 },
			tasks: [],
		};
		const colocated: Task = { source: block.source, text: "Run", status: " " };
		const thu = thursday();
		const res = moveTaskIntoBlockAcrossDays([block], thu, block, colocated, thu[0]!, "thu.md");
		expect(res.to).toBe(thu);
	});
});

describe("blockForTask", () => {
	const task: Task = {
		source: { path: "x.md", line: 1 },
		text: "Launch post",
		status: "/",
		assoc: { kind: "project", id: "Kairos" },
		metadata: "p1",
	};

	it("names a container block after the association and nests the task", () => {
		const block = blockForTask(task, TWO_PM, "thu.md", "container");
		expect(block.title).toBe("Kairos");
		expect(block.assoc).toEqual({ kind: "project", id: "Kairos" });
		expect(block.status).toBeUndefined();
		expect(block.time).toEqual(TWO_PM);
		expect(block.tasks).toHaveLength(1);
		expect(block.tasks[0]!.text).toBe("Launch post");
		expect(block.tasks[0]!.assoc).toEqual({ kind: "project", id: "Kairos" });
		// Distinct draft lines for the block and its task.
		expect(block.source.line).not.toBe(block.tasks[0]!.source.line);
	});

	it("falls back to the default title without an association", () => {
		const { assoc: _a, ...bare } = task;
		const block = blockForTask(bare, TWO_PM, "thu.md", "container");
		expect(block.title).toBe("New block");
		expect(block.assoc).toBeUndefined();
	});

	it("turns the task into a checkable block when time-boxing", () => {
		const block = blockForTask(task, TWO_PM, "thu.md", "timebox");
		expect(block.title).toBe("Launch post");
		expect(block.status).toBe("/");
		expect(block.assoc).toEqual({ kind: "project", id: "Kairos" });
		expect(block.metadata).toBe("p1");
		expect(block.tasks).toEqual([]);
	});
});

describe("scheduleTaskInNewBlock", () => {
	it("moves the task out of Unscheduled into a new block on the same day", () => {
		const wed = wednesday();
		const next = scheduleTaskInNewBlock(wed, inbox(wed), launch(wed), TWO_PM, "container");
		expect(inbox(next).tasks.map((t) => t.text)).toEqual(["Groceries"]);
		const created = next.at(-1)!;
		expect(created.title).toBe("Kairos");
		expect(created.time).toEqual(TWO_PM);
		expect(created.source.path).toBe("wed.md");
		expect(created.tasks.map((t) => t.text)).toEqual(["Launch post"]);
	});

	it("time-boxes an inheriting task with the association it had", () => {
		const wed = wednesday();
		const next = scheduleTaskInNewBlock(wed, wed[0]!, fixBug(wed), TWO_PM, "timebox");
		expect(next[0]!.tasks).toEqual([]);
		const created = next.at(-1)!;
		expect(created.title).toBe("Fix carry bug");
		expect(created.status).toBe(" ");
		expect(created.assoc).toEqual({ kind: "project", id: "Kairos" });
	});

	it("is a no-op for an unknown task", () => {
		const wed = wednesday();
		const ghost: Task = { source: { path: "wed.md", line: 99 }, text: "?", status: " " };
		expect(scheduleTaskInNewBlock(wed, wed[0]!, ghost, TWO_PM, "container")).toBe(wed);
	});
});

describe("scheduleTaskInNewBlockAcrossDays", () => {
	it("lifts the task from its day and adds the new block to the target day", () => {
		const wed = wednesday();
		const thu = thursday();
		const { from, to } = scheduleTaskInNewBlockAcrossDays(
			wed, thu, inbox(wed), launch(wed), "thu.md", TWO_PM, "container",
		);
		expect(inbox(from).tasks.map((t) => t.text)).toEqual(["Groceries"]);
		expect(to).toHaveLength(2);
		const created = to.at(-1)!;
		expect(created.source.path).toBe("thu.md");
		expect(created.tasks[0]!.source.path).toBe("thu.md");
	});
});

describe("copies", () => {
	it("copies a task into a block, leaving the source alone", () => {
		const wed = wednesday();
		const thu = thursday();
		const next = copyTaskIntoBlock(thu, launch(wed), { kind: "project", id: "Kairos" }, thu[0]!);
		expect(next[0]!.tasks.map((t) => t.text)).toEqual(["Outline", "Launch post"]);
		expect(next[0]!.tasks[1]!.source.path).toBe("thu.md");
		expect(inbox(wed).tasks).toHaveLength(2);
	});

	it("copies a task into a new block with the given association", () => {
		const thu = thursday();
		const wed = wednesday();
		const next = copyTaskIntoNewBlock(thu, fixBug(wed), { kind: "project", id: "Kairos" }, "thu.md", TWO_PM, "container");
		const created = next.at(-1)!;
		expect(created.title).toBe("Kairos");
		expect(created.tasks[0]!.assoc).toEqual({ kind: "project", id: "Kairos" });
	});
});
