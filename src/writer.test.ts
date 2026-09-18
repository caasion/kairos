import { describe, expect, it } from "vitest";
import {
	copyBlockIntoDay,
	makeBlock,
	moveBlockAcrossDays,
	nestTaskUnderBlock,
	unnestTask,
} from "./writer";
import type { Block, Task } from "./types";

// A timed block with an explicit project association and two child tasks: one
// with its own association, one inheriting the block's.
function sampleBlock(path: string): Block {
	return {
		source: { path, line: 3 },
		title: "Deep work",
		assoc: { kind: "project", id: "Kairos" },
		scheduled: true,
		time: { start: 540, end: 600 },
		tasks: [
			{ source: { path, line: 4 }, text: "Design", status: " " },
			{
				source: { path, line: 5 },
				text: "Emails",
				status: " ",
				assoc: { kind: "domain", id: "Admin" },
			},
		],
	};
}

describe("moveBlockAcrossDays", () => {
	it("removes the block from the source day", () => {
		const block = sampleBlock("mon.md");
		const other: Block = {
			source: { path: "mon.md", line: 8 },
			title: "Lunch",
			scheduled: true,
			time: { start: 720, end: 780 },
			tasks: [],
		};
		const { from } = moveBlockAcrossDays(
			[other, block],
			[],
			block,
			"tue.md",
		);
		expect(from).toHaveLength(1);
		expect(from[0]?.title).toBe("Lunch");
	});

	it("inserts the block into the target day, repointed at the target path", () => {
		const block = sampleBlock("mon.md");
		const { to } = moveBlockAcrossDays([block], [], block, "tue.md");
		expect(to).toHaveLength(1);
		const moved = to[0]!;
		expect(moved.source.path).toBe("tue.md");
		// Child tasks route to the target file too.
		expect(moved.tasks.every((t) => t.source.path === "tue.md")).toBe(true);
	});

	it("preserves association inheritance across the move (nothing to materialize)", () => {
		const block = sampleBlock("mon.md");
		const { to } = moveBlockAcrossDays([block], [], block, "tue.md");
		const moved = to[0]!;
		// Block keeps its own explicit association …
		expect(moved.assoc).toEqual({ kind: "project", id: "Kairos" });
		// … so the inheriting task still has no explicit assoc (inherits block),
		// and the explicitly-associated task keeps its own.
		expect(moved.tasks[0]?.assoc).toBeUndefined();
		expect(moved.tasks[1]?.assoc).toEqual({ kind: "domain", id: "Admin" });
	});

	it("retimes the block when a new range is given, else keeps its time", () => {
		const block = sampleBlock("mon.md");
		const retimed = moveBlockAcrossDays([block], [], block, "tue.md", {
			start: 600,
			end: 660,
		}).to[0]!;
		expect(retimed.time).toEqual({ start: 600, end: 660 });

		const kept = moveBlockAcrossDays([block], [], block, "tue.md").to[0]!;
		expect(kept.time).toEqual({ start: 540, end: 600 });
	});

	it("appends to an existing target day without disturbing its blocks", () => {
		const block = sampleBlock("mon.md");
		const existing: Block = {
			source: { path: "tue.md", line: 3 },
			title: "Standup",
			scheduled: true,
			time: { start: 570, end: 585 },
			tasks: [],
		};
		const { to } = moveBlockAcrossDays([block], [existing], block, "tue.md");
		expect(to).toHaveLength(2);
		expect(to[0]?.title).toBe("Standup");
		expect(to[1]?.title).toBe("Deep work");
	});

	it("does not mutate the input arrays", () => {
		const block = sampleBlock("mon.md");
		const from = [block];
		const to: Block[] = [];
		moveBlockAcrossDays(from, to, block, "tue.md");
		expect(from).toHaveLength(1);
		expect(to).toHaveLength(0);
	});
});

describe("unnestTask", () => {
	// The nested tasks of sampleBlock: line 4 "Design" (inherits the block's
	// [Kairos] project), line 5 "Emails" (its own [D:Admin] domain).
	const inheritingTask = (path: string): Task =>
		sampleBlock(path).tasks[0]!;
	const explicitTask = (path: string): Task => sampleBlock(path).tasks[1]!;

	it("moves a nested task into a newly-created Unscheduled block", () => {
		const block = sampleBlock("mon.md");
		const out = unnestTask([block], block, inheritingTask("mon.md"), "mon.md");

		const source = out.find((b) => b.title === "Deep work")!;
		const inbox = out.find((b) => b.title === "Unscheduled")!;
		expect(source.tasks.map((t) => t.text)).toEqual(["Emails"]); // Design left
		expect(inbox.time).toBeUndefined();
		expect(inbox.scheduled).toBe(false);
		expect(inbox.tasks.map((t) => t.text)).toEqual(["Design"]);
	});

	it("materializes the inherited association onto the moved task", () => {
		const block = sampleBlock("mon.md");
		const out = unnestTask([block], block, inheritingTask("mon.md"), "mon.md");
		const moved = out.find((b) => b.title === "Unscheduled")!.tasks[0]!;
		// "Design" inherited [Kairos] from the block; now it carries it explicitly.
		expect(moved.assoc).toEqual({ kind: "project", id: "Kairos" });
	});

	it("leaves an explicitly-associated task's association unchanged", () => {
		const block = sampleBlock("mon.md");
		const out = unnestTask([block], block, explicitTask("mon.md"), "mon.md");
		const moved = out.find((b) => b.title === "Unscheduled")!.tasks[0]!;
		expect(moved.assoc).toEqual({ kind: "domain", id: "Admin" });
	});

	it("appends into an existing Unscheduled block rather than making a new one", () => {
		const block = sampleBlock("mon.md");
		const inbox: Block = {
			source: { path: "mon.md", line: 20 },
			title: "Unscheduled",
			scheduled: false,
			tasks: [{ source: { path: "mon.md", line: 21 }, text: "Old", status: " " }],
		};
		const out = unnestTask(
			[block, inbox],
			block,
			inheritingTask("mon.md"),
			"mon.md",
		);
		const inboxes = out.filter((b) => b.title === "Unscheduled");
		expect(inboxes).toHaveLength(1); // no duplicate inbox
		expect(inboxes[0]!.tasks.map((t) => t.text)).toEqual(["Old", "Design"]);
	});

	it("gives the new inbox a line no other block in the day can hold", () => {
		// The inbox line used to be derived as `task.line - 1`, which for a task
		// sitting directly under its block IS that block's own line — and two
		// blocks sharing a source line make every later edit to one land on the
		// other. It must come from the draft-line allocator instead.
		const block = sampleBlock("mon.md");
		const out = unnestTask([block], block, inheritingTask("mon.md"), "mon.md");

		const lines = out.map((b) => b.source.line);
		expect(new Set(lines).size).toBe(lines.length);
		const inbox = out.find((b) => b.title === "Unscheduled")!;
		expect(inbox.source.line).toBeLessThan(0); // not yet on disk
	});

	it("is a no-op for a colocated task (a checkable block isn't unnestable)", () => {
		// A checkable block: its own line carries the checkbox, so the 'task' the
		// UI hands back shares the block's source line — it is not in `tasks`.
		const block: Block = {
			source: { path: "mon.md", line: 3 },
			title: "Gym",
			status: " ",
			scheduled: true,
			time: { start: 540, end: 600 },
			tasks: [],
		};
		const colocated: Task = {
			source: { path: "mon.md", line: 3 },
			text: "Gym",
			status: " ",
		};
		expect(unnestTask([block], block, colocated, "mon.md")).toEqual([block]);
	});

	it("does not mutate the input array", () => {
		const block = sampleBlock("mon.md");
		const input = [block];
		unnestTask(input, block, inheritingTask("mon.md"), "mon.md");
		expect(input).toHaveLength(1);
		expect(input[0]!.tasks).toHaveLength(2);
	});
});

describe("nestTaskUnderBlock", () => {
	// The nested tasks of sampleBlock: line 4 "Design" (inherits [Kairos]),
	// line 5 "Emails" (its own [D:Admin]).
	const inheritingTask = (path: string): Task => sampleBlock(path).tasks[0]!;
	const explicitTask = (path: string): Task => sampleBlock(path).tasks[1]!;

	// A second timed block with its own association and one existing task, to
	// nest into.
	function otherBlock(path: string): Block {
		return {
			source: { path, line: 10 },
			title: "Meetings",
			assoc: { kind: "domain", id: "Work" },
			scheduled: true,
			time: { start: 780, end: 840 },
			tasks: [{ source: { path, line: 11 }, text: "Standup", status: " " }],
		};
	}

	it("moves a nested task out of its block and into the destination", () => {
		const source = sampleBlock("mon.md");
		const dest = otherBlock("mon.md");
		const out = nestTaskUnderBlock(
			[source, dest],
			source,
			inheritingTask("mon.md"),
			dest,
		);
		const outSource = out.find((b) => b.title === "Deep work")!;
		const outDest = out.find((b) => b.title === "Meetings")!;
		expect(outSource.tasks.map((t) => t.text)).toEqual(["Emails"]); // Design left
		expect(outDest.tasks.map((t) => t.text)).toEqual(["Standup", "Design"]);
	});

	it("materializes the inherited association onto the moved task", () => {
		const source = sampleBlock("mon.md");
		const dest = otherBlock("mon.md");
		const out = nestTaskUnderBlock(
			[source, dest],
			source,
			inheritingTask("mon.md"),
			dest,
		);
		const moved = out
			.find((b) => b.title === "Meetings")!
			.tasks.find((t) => t.text === "Design")!;
		// "Design" inherited [Kairos] from its old block; it now carries it
		// explicitly, so nesting under [Work] doesn't silently re-own it.
		expect(moved.assoc).toEqual({ kind: "project", id: "Kairos" });
	});

	it("leaves an explicitly-associated task's association unchanged", () => {
		const source = sampleBlock("mon.md");
		const dest = otherBlock("mon.md");
		const out = nestTaskUnderBlock(
			[source, dest],
			source,
			explicitTask("mon.md"),
			dest,
		);
		const moved = out
			.find((b) => b.title === "Meetings")!
			.tasks.find((t) => t.text === "Emails")!;
		expect(moved.assoc).toEqual({ kind: "domain", id: "Admin" });
	});

	it("inserts at the given index among the destination's tasks", () => {
		const source = sampleBlock("mon.md");
		const dest = otherBlock("mon.md");
		const out = nestTaskUnderBlock(
			[source, dest],
			source,
			inheritingTask("mon.md"),
			dest,
			0, // before "Standup"
		);
		const outDest = out.find((b) => b.title === "Meetings")!;
		expect(outDest.tasks.map((t) => t.text)).toEqual(["Design", "Standup"]);
	});

	it("clamps an out-of-range index to an append", () => {
		const source = sampleBlock("mon.md");
		const dest = otherBlock("mon.md");
		const out = nestTaskUnderBlock(
			[source, dest],
			source,
			inheritingTask("mon.md"),
			dest,
			99,
		);
		const outDest = out.find((b) => b.title === "Meetings")!;
		expect(outDest.tasks.map((t) => t.text)).toEqual(["Standup", "Design"]);
	});

	it("reorders within the same block (drain then re-insert at the slot)", () => {
		const block = sampleBlock("mon.md"); // ["Design", "Emails"]
		// Move "Design" (index 0) to the end of its own block.
		const out = nestTaskUnderBlock(
			[block],
			block,
			inheritingTask("mon.md"),
			block,
			1,
		);
		const outBlock = out.find((b) => b.title === "Deep work")!;
		expect(outBlock.tasks.map((t) => t.text)).toEqual(["Emails", "Design"]);
	});

	it("is a no-op for a colocated task (a checkable block isn't liftable)", () => {
		const block: Block = {
			source: { path: "mon.md", line: 3 },
			title: "Gym",
			status: " ",
			scheduled: true,
			time: { start: 540, end: 600 },
			tasks: [],
		};
		const dest = otherBlock("mon.md");
		const colocated: Task = {
			source: { path: "mon.md", line: 3 },
			text: "Gym",
			status: " ",
		};
		const input = [block, dest];
		expect(nestTaskUnderBlock(input, block, colocated, dest)).toBe(input);
	});

	it("is a no-op when the destination block isn't in the array", () => {
		const source = sampleBlock("mon.md");
		const dest = otherBlock("mon.md");
		const input = [source]; // dest absent
		expect(
			nestTaskUnderBlock(input, source, inheritingTask("mon.md"), dest),
		).toBe(input);
	});

	it("does not mutate the input arrays", () => {
		const source = sampleBlock("mon.md");
		const dest = otherBlock("mon.md");
		const input = [source, dest];
		nestTaskUnderBlock(input, source, inheritingTask("mon.md"), dest);
		expect(input[0]!.tasks).toHaveLength(2);
		expect(input[1]!.tasks).toHaveLength(1);
	});
});

// ─── draft-line uniqueness ─────────────────────────────────────
//
// Every unsaved block and task carries a negative placeholder line until the
// note is rewritten and reparsed. Views key their `{#each}` by that line, and
// writes are debounced, so several drafts coexist routinely — two of them
// sharing a line is the duplicate-key error that freezes a view. These pin the
// invariant on the two cross-day primitives, which are the ones that land a
// whole block (plus its children) in a day the user is already looking at.

/** Every source line in `blocks`, including each block's child tasks. */
function allLines(blocks: Block[]): number[] {
	return blocks.flatMap((b) => [
		b.source.line,
		...b.tasks.map((t) => t.source.line),
	]);
}

describe("draft lines are unique across the cross-day primitives", () => {
	it("gives a moved block and each of its tasks a distinct negative line", () => {
		const { to } = moveBlockAcrossDays(
			[sampleBlock("mon.md")],
			[],
			sampleBlock("mon.md"),
			"tue.md",
		);
		const lines = allLines(to);
		expect(lines).toHaveLength(3); // block + two tasks
		expect(lines.every((l) => l < 0)).toBe(true);
		expect(new Set(lines).size).toBe(lines.length);
	});

	it("never reuses a line when two blocks move into the same day", () => {
		// Two drops inside the debounce window: the second reads the first's
		// optimistic array, so both drafts are live in one keyed list.
		const first = moveBlockAcrossDays(
			[sampleBlock("mon.md")],
			[],
			sampleBlock("mon.md"),
			"wed.md",
		).to;
		const both = moveBlockAcrossDays(
			[sampleBlock("tue.md")],
			first,
			sampleBlock("tue.md"),
			"wed.md",
		).to;

		const lines = allLines(both);
		expect(both).toHaveLength(2);
		expect(new Set(lines).size).toBe(lines.length);
	});

	it("never reuses a line when one block is duplicated twice into a day", () => {
		const block = sampleBlock("mon.md");
		const once = copyBlockIntoDay([], block, "wed.md");
		const twice = copyBlockIntoDay(once, block, "wed.md");

		const lines = allLines(twice);
		expect(twice).toHaveLength(2);
		expect(new Set(lines).size).toBe(lines.length);
	});

	it("never collides with a block created by makeBlock in the same day", () => {
		const fresh = makeBlock({ start: 540, end: 600 }, "wed.md");
		const to = copyBlockIntoDay([fresh], sampleBlock("mon.md"), "wed.md");

		const lines = allLines(to);
		expect(new Set(lines).size).toBe(lines.length);
	});
});
