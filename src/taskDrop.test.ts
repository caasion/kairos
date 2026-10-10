import { describe, expect, it } from "vitest";
import { newBlockLabel, planTaskDrop, type DayBlocks, type DragSource } from "./taskDrop";
import type { Block } from "./types";

const plain = { duplicate: false, timebox: false };

function wed(): DayBlocks {
	const blocks: Block[] = [
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
			tasks: [{ source: { path: "wed.md", line: 7 }, text: "Launch post", status: " ", assoc: { kind: "project", id: "Kairos" } }],
		},
	];
	return { date: "2026-10-07", path: "wed.md", blocks };
}

function thu(): DayBlocks {
	return {
		date: "2026-10-08",
		path: "thu.md",
		blocks: [
			{
				source: { path: "thu.md", line: 3 },
				title: "Deep work",
				scheduled: true,
				time: { start: 540, end: 630 },
				tasks: [],
			},
		],
	};
}

function launchFrom(day: DayBlocks): DragSource {
	const owner = day.blocks[1]!;
	return { day, owner, task: owner.tasks[0]! };
}

describe("planTaskDrop", () => {
	it("nests on the same day", () => {
		const day = wed();
		const out = planTaskDrop(launchFrom(day), day, { kind: "block", date: day.date, blockLine: 3, index: 0 }, plain);
		expect(out?.kind).toBe("day");
		if (out?.kind !== "day") return;
		expect(out.day.blocks[0]!.tasks.map((t) => t.text)).toEqual(["Launch post", "Fix carry bug"]);
	});

	it("moves to a block on another day", () => {
		const source = launchFrom(wed());
		const target = thu();
		const out = planTaskDrop(source, target, { kind: "block", date: target.date, blockLine: 3, index: 0 }, plain);
		expect(out?.kind).toBe("cross");
		if (out?.kind !== "cross") return;
		expect(out.from.date).toBe("2026-10-07");
		expect(out.to.blocks[0]!.tasks.map((t) => t.text)).toEqual(["Launch post"]);
	});

	it("creates a block named after the association on empty time", () => {
		const source = launchFrom(wed());
		const target = thu();
		const out = planTaskDrop(source, target, { kind: "time", date: target.date, time: { start: 840, end: 870 } }, plain);
		if (out?.kind !== "cross") throw new Error("expected a cross-day move");
		const created = out.to.blocks.at(-1)!;
		expect(created.title).toBe("Kairos");
		expect(created.tasks.map((t) => t.text)).toEqual(["Launch post"]);
	});

	it("time-boxes with Option held", () => {
		const day = wed();
		const out = planTaskDrop(launchFrom(day), day, { kind: "time", date: day.date, time: { start: 840, end: 870 } }, { duplicate: false, timebox: true });
		if (out?.kind !== "day") throw new Error("expected a same-day edit");
		const created = out.day.blocks.at(-1)!;
		expect(created.title).toBe("Launch post");
		expect(created.status).toBe(" ");
	});

	it("copies to the target only with Ctrl/Cmd held", () => {
		const source = launchFrom(wed());
		const target = thu();
		const out = planTaskDrop(source, target, { kind: "block", date: target.date, blockLine: 3, index: 0 }, { duplicate: true, timebox: false });
		if (out?.kind !== "day") throw new Error("expected only the target to change");
		expect(out.day.date).toBe(target.date);
		expect(out.day.blocks[0]!.tasks[0]!.assoc).toEqual({ kind: "project", id: "Kairos" });
	});

	it("returns null when the block is gone", () => {
		const day = wed();
		expect(planTaskDrop(launchFrom(day), day, { kind: "block", date: day.date, blockLine: 42, index: 0 }, plain)).toBeNull();
	});

	it("returns null for a checkable block's own checkbox", () => {
		const block: Block = {
			source: { path: "wed.md", line: 2 },
			title: "Run",
			status: " ",
			scheduled: true,
			time: { start: 420, end: 450 },
			tasks: [],
		};
		const day: DayBlocks = { date: "2026-10-07", path: "wed.md", blocks: [block] };
		const source: DragSource = { day, owner: block, task: { source: block.source, text: "Run", status: " " } };
		expect(planTaskDrop(source, thu(), { kind: "time", date: "2026-10-08", time: { start: 840, end: 870 } }, plain)).toBeNull();
	});
});

describe("newBlockLabel", () => {
	it("names the block after the task's or block's association", () => {
		const day = wed();
		const owner = day.blocks[0]!;
		expect(newBlockLabel(owner.tasks[0]!, owner, plain)).toBe("Kairos");
		expect(newBlockLabel({ ...owner.tasks[0]! }, { ...owner, assoc: undefined }, plain)).toBe("New block");
		expect(newBlockLabel(owner.tasks[0]!, owner, { duplicate: false, timebox: true })).toBe("Fix carry bug");
	});
});
