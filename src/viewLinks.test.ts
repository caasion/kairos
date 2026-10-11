import { describe, expect, it } from "vitest";
import {
	blockLit,
	hoverBlockTarget,
	hoverTaskTarget,
	taskHighlight,
	ViewLinks,
} from "./viewLinks";
import type { Block, Task } from "./types";

const path = "2026-10-12 Mon.md";
const lectures: Block = {
	source: { path, line: 3 },
	title: "Lectures",
	scheduled: true,
	time: { start: 510, end: 680 },
	tasks: [
		{ source: { path, line: 4 }, text: "Bring lab kit", status: " " },
		{ source: { path, line: 5 }, text: "Hand in problem set 5", status: " " },
	],
};
const inbox: Block = {
	source: { path, line: 9 },
	title: "Unscheduled",
	scheduled: false,
	tasks: [{ source: { path, line: 10 }, text: "Pick up parcel", status: " " }],
};
const [labKit, problemSet] = lectures.tasks as [Task, Task];
const parcel = inbox.tasks[0]!;

describe("the shared highlight rule", () => {
	it("lights the whole block, header and tasks, when its header is pointed at", () => {
		const hover = hoverBlockTarget(lectures);
		expect(blockLit(hover, lectures)).toBe(true);
		expect(taskHighlight(hover, labKit, lectures)).toBe("block");
		expect(taskHighlight(hover, problemSet, lectures)).toBe("block");
	});

	it("lights the block and marks the task when a task in it is pointed at", () => {
		const hover = hoverTaskTarget(labKit, lectures);
		expect(blockLit(hover, lectures)).toBe(true);
		expect(taskHighlight(hover, labKit, lectures)).toBe("task");
		expect(taskHighlight(hover, problemSet, lectures)).toBe("block");
	});

	it("marks only the task in an untimed block", () => {
		const hover = hoverTaskTarget(parcel, inbox);
		expect(blockLit(hover, inbox)).toBe(false);
		expect(taskHighlight(hover, parcel, inbox)).toBe("task");
	});

	it("lights nothing in another block or another note", () => {
		const hover = hoverTaskTarget(labKit, lectures);
		expect(blockLit(hover, inbox)).toBe(false);
		const elsewhere: Block = { ...lectures, source: { path: "2026-10-13 Tue.md", line: 3 } };
		expect(blockLit(hover, elsewhere)).toBe(false);
		expect(taskHighlight(null, labKit, lectures)).toBeNull();
	});
});

describe("ViewLinks", () => {
	it("ignores hover while a drag is live and clears only the item it names", () => {
		const links = new ViewLinks();
		let seen: unknown = undefined;
		links.hover$.subscribe((h) => (seen = h));
		links.setHover(hoverBlockTarget(lectures));
		expect(seen).toMatchObject({ kind: "block", line: 3 });
		links.clearHover(hoverBlockTarget(inbox));
		expect(seen).toMatchObject({ kind: "block", line: 3 });
		links.setDrag({ from: { date: "2026-10-12", line: 4 }, drop: null, label: "x", duplicate: false, timebox: false });
		expect(seen).toBeNull();
		links.setHover(hoverBlockTarget(lectures));
		expect(seen).toBeNull();
	});
});

describe("the highlight setting", () => {
	it("clears the highlight when turned off and ignores hovers until turned on", () => {
		const links = new ViewLinks();
		let seen: unknown = undefined;
		links.hover$.subscribe((h) => (seen = h));
		links.setHover(hoverBlockTarget(lectures));
		links.setHoverEnabled(false);
		expect(seen).toBeNull();
		links.setHover(hoverBlockTarget(lectures));
		expect(seen).toBeNull();
		links.setHoverEnabled(true);
		links.setHover(hoverBlockTarget(lectures));
		expect(seen).toMatchObject({ kind: "block" });
	});
});
