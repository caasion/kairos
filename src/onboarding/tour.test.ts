import { describe, expect, it } from "vitest";
import { intersect, placePopover } from "./placement";
import {
	findExact,
	findNewBlock,
	follow,
	locate,
	statusChanged,
	summarizeDay,
	track,
} from "./tourProgress";
import type { BlockSummary } from "./tourProgress";
import { STEPS, isStepDone, resumeStep } from "./tourSteps";
import type { StepContext } from "./tourSteps";
import type { Day } from "../types";

const path = "2026-10-29.md";

function block(line: number, title: string, start: number, end: number): BlockSummary {
	return { line, title, start, end, tasks: [] };
}

describe("summarizeDay", () => {
	it("keeps scheduled blocks and copies their tasks", () => {
		const day: Day = {
			date: "2026-10-29",
			path,
			mtime: 0,
			blocks: [
				{
					source: { path, line: 2 },
					title: "Deep work",
					scheduled: true,
					time: { start: 570, end: 660 },
					tasks: [{ source: { path, line: 3 }, text: "Outline", status: " " }],
				},
				{ source: { path, line: 5 }, title: "Unscheduled", scheduled: false, tasks: [] },
			],
		};
		const out = summarizeDay(day);
		expect(out).toEqual([
			{ line: 2, title: "Deep work", start: 570, end: 660, tasks: [{ text: "Outline", status: " " }] },
		]);
		// A copy: the Day view mutates its blocks in place.
		day.blocks[0]!.tasks[0]!.status = "x";
		expect(out[0]!.tasks[0]!.status).toBe(" ");
	});

	it("is empty without a note", () => {
		expect(summarizeDay(undefined)).toEqual([]);
	});
});

describe("findNewBlock", () => {
	const base = [block(2, "Swim", 780, 840)];

	it("finds the block the day gained", () => {
		const now = [block(-1, "New block", 540, 600), block(4, "Swim", 780, 840)];
		expect(findNewBlock(base, now)?.start).toBe(540);
	});

	it("ignores a retime that adds nothing", () => {
		expect(findNewBlock(base, [block(2, "Swim", 800, 860)])).toBeUndefined();
	});

	it("ignores a block that arrived already named (sync, routines)", () => {
		const now = [block(-1, "Gym", 540, 600), block(4, "Swim", 780, 840)];
		expect(findNewBlock(base, now)).toBeUndefined();
	});
});

describe("findExact", () => {
	const tracked = track("2026-11-03", block(5, "Deep work", 540, 600));

	it("finds the block where the tour last saw it", () => {
		expect(findExact(tracked, [block(5, "Deep work", 540, 600)])?.line).toBe(5);
	});

	it("never falls back to a same-title or same-time block of the person's", () => {
		expect(findExact(tracked, [block(9, "Deep work", 540, 600)])).toBeUndefined();
		expect(findExact(tracked, [block(5, "Gym", 540, 600)])).toBeUndefined();
		expect(findExact(tracked, [block(5, "Deep work", 600, 660)])).toBeUndefined();
	});
});

describe("locate and follow", () => {
	const tracked = track("2026-10-29", block(-1, "New block", 540, 600));

	it("finds the block again after a reparse changes its line", () => {
		const found = locate(tracked, [block(2, "New block", 540, 600)]);
		expect(found?.line).toBe(2);
	});

	it("finds it by line after a rename and retime", () => {
		const t = follow(tracked, block(2, "New block", 540, 600));
		const found = locate(t, [block(2, "Deep work", 540, 630)]);
		expect(found?.title).toBe("Deep work");
		expect(follow(t, found!).createdTitle).toBe("New block");
	});
});

describe("statusChanged", () => {
	it("notices a task's status moving", () => {
		expect(statusChanged([{ text: "a", status: " " }], [{ text: "a", status: "/" }])).toBe(true);
	});

	it("ignores a task added in between", () => {
		expect(
			statusChanged([{ text: "a", status: " " }], [{ text: "a", status: " " }, { text: "b", status: "x" }]),
		).toBe(false);
	});
});

describe("isStepDone", () => {
	const ctx: StepContext = { dayOpen: false, noteOpened: false };
	const tracked = track("2026-10-29", block(2, "New block", 540, 600));

	it("waits for each step's action", () => {
		expect(isStepDone("open-day", ctx)).toBe(false);
		expect(isStepDone("open-day", { ...ctx, dayOpen: true })).toBe(true);
		expect(isStepDone("make-block", { ...ctx, tracked })).toBe(true);
		expect(isStepDone("finish", { ...ctx, dayOpen: true, tracked })).toBe(false);
	});

	it("counts a rename only away from the created title", () => {
		const same = { ...ctx, tracked, current: block(2, "New block", 540, 600) };
		expect(isStepDone("rename", same)).toBe(false);
		expect(isStepDone("rename", { ...same, current: block(2, "Deep work", 540, 600) })).toBe(true);
	});

	it("compares tasks against the step's start", () => {
		const before = block(2, "Deep work", 540, 600);
		const after = { ...before, tasks: [{ text: "Outline", status: " " as const }] };
		expect(isStepDone("add-task", { ...ctx, tracked, atStepStart: before, current: after })).toBe(true);
		expect(isStepDone("add-task", { ...ctx, tracked, atStepStart: after, current: after })).toBe(false);
		const checked = { ...after, tasks: [{ text: "Outline", status: "x" as const }] };
		expect(isStepDone("check", { ...ctx, tracked, atStepStart: after, current: checked })).toBe(true);
	});
});

describe("resumeStep", () => {
	const makeBlock = STEPS.findIndex((s) => s.id === "make-block");

	it("goes back to making a block when the tracked one is gone", () => {
		expect(resumeStep(makeBlock + 2, false)).toBe(makeBlock);
		expect(resumeStep(makeBlock + 2, true)).toBe(makeBlock + 2);
	});

	it("keeps the last step and clamps out-of-range steps", () => {
		expect(resumeStep(STEPS.length - 1, false)).toBe(STEPS.length - 1);
		expect(resumeStep(99, true)).toBe(STEPS.length - 1);
		expect(resumeStep(-3, false)).toBe(0);
	});
});

describe("placePopover", () => {
	const size = { width: 300, height: 150 };
	const viewport = { width: 1200, height: 800 };

	it("prefers the left of a sidebar anchor", () => {
		const p = placePopover({ left: 900, top: 300, width: 200, height: 40 }, size, viewport);
		expect(p.side).toBe("left");
		expect(p.left).toBe(900 - 12 - 300);
	});

	it("falls back below when neither side has room", () => {
		const p = placePopover({ left: 100, top: 100, width: 1000, height: 40 }, size, viewport);
		expect(p.side).toBe("below");
	});

	it("docks in the corner with no anchor", () => {
		expect(placePopover(null, size, viewport)).toEqual({ left: 884, top: 634, side: "corner" });
	});
});

describe("intersect", () => {
	it("clips to the overlap, or null", () => {
		expect(intersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 })).toEqual({
			left: 5,
			top: 5,
			width: 5,
			height: 5,
		});
		expect(intersect({ left: 0, top: 0, width: 1, height: 1 }, { left: 5, top: 5, width: 1, height: 1 })).toBeNull();
	});
});
