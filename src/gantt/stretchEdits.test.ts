import { describe, expect, it } from "vitest";
import type { StatusRecord } from "../types";
import { normalizeHistory } from "../projectFile";
import {
	applyStretchEdit,
	canRemoveEnd,
	canSplitAt,
	deleteStretch,
	mergeableNext,
	mergeWithNext,
	removeEnd,
	splitStretch,
	stretchBounds,
} from "./stretchEdits";

const TODAY = "2026-06-30";

const h = (...rs: [string, "active" | "inactive" | "archived", string?][]): StatusRecord[] =>
	rs.map(([date, status, note]) => ({ date, status, ...(note ? { note } : {}) }));

// Compact view of a history: "date status[:note]".
const show = (hist: StatusRecord[]) =>
	normalizeHistory(hist).map((r) => `${r.date} ${r.status}${r.note ? `:${r.note}` : ""}`);

// A: 1–10 June, touching B: 10–20 June, then a gap, then C from 25 June, open.
const touching = h(
	["2026-06-01", "active", "A"],
	["2026-06-10", "active", "B"],
	["2026-06-20", "inactive"],
	["2026-06-25", "active", "C"],
);

describe("end edge", () => {
	it("shrinking away from a touching neighbour opens a gap and leaves it in place", () => {
		expect(show(applyStretchEdit(touching, "2026-06-01", "end", "2026-06-07", TODAY))).toEqual([
			"2026-06-01 active:A",
			"2026-06-07 inactive",
			"2026-06-10 active:B",
			"2026-06-20 inactive",
			"2026-06-25 active:C",
		]);
	});

	it("growing into a touching neighbour trims it, never below one day", () => {
		expect(stretchBounds(touching, "2026-06-01", "end", TODAY)).toEqual({
			min: "2026-06-02",
			max: "2026-06-19",
		});
		expect(show(applyStretchEdit(touching, "2026-06-01", "end", "2026-06-30", TODAY))).toEqual([
			"2026-06-01 active:A",
			"2026-06-19 active:B",
			"2026-06-20 inactive",
			"2026-06-25 active:C",
		]);
	});

	it("moves a gap closer, keeping its why", () => {
		const hist: StatusRecord[] = [
			{ date: "2026-06-10", status: "active", note: "B" },
			{ date: "2026-06-20", status: "inactive", why: "trip" },
		];
		const out = applyStretchEdit(hist, "2026-06-10", "end", "2026-06-15", TODAY);
		expect(out[1]).toEqual({ date: "2026-06-15", status: "inactive", why: "trip" });
	});

	it("growing across a gap into the next stretch drops the gap and trims it", () => {
		expect(show(applyStretchEdit(touching, "2026-06-10", "end", "2026-06-25", TODAY))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 active:B",
			"2026-06-25 active:C",
		]);
		expect(show(applyStretchEdit(touching, "2026-06-10", "end", "2026-06-27", TODAY))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 active:B",
			"2026-06-27 active:C",
		]);
	});

	it("leaves an open-ended neighbour today as its last day", () => {
		expect(stretchBounds(touching, "2026-06-10", "end", TODAY)?.max).toBe(TODAY);
	});

	it("gives an open-ended stretch an end", () => {
		expect(show(applyStretchEdit(touching, "2026-06-25", "end", "2026-06-28", TODAY)).at(-1)).toBe(
			"2026-06-28 inactive",
		);
	});

	it("stops at a record that isn't a stretch", () => {
		const hist = h(["2026-06-01", "active"], ["2026-06-05", "inactive"], ["2026-06-09", "archived"]);
		expect(stretchBounds(hist, "2026-06-01", "end", TODAY)?.max).toBe("2026-06-09");
		expect(show(applyStretchEdit(hist, "2026-06-01", "end", "2026-06-12", TODAY))).toEqual([
			"2026-06-01 active",
			"2026-06-09 archived",
		]);
	});
});

describe("start edge", () => {
	it("shrinking away from a touching neighbour opens a gap", () => {
		expect(show(applyStretchEdit(touching, "2026-06-10", "start", "2026-06-13", TODAY))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 inactive",
			"2026-06-13 active:B",
			"2026-06-20 inactive",
			"2026-06-25 active:C",
		]);
	});

	it("growing into a touching neighbour trims it, never below one day", () => {
		expect(stretchBounds(touching, "2026-06-10", "start", TODAY)).toEqual({
			min: "2026-06-02",
			max: "2026-06-19",
		});
		expect(show(applyStretchEdit(touching, "2026-06-10", "start", "2026-05-01", TODAY))[1]).toBe(
			"2026-06-02 active:B",
		);
	});

	it("growing across a gap drops the gap and trims the stretch before it", () => {
		expect(show(applyStretchEdit(touching, "2026-06-25", "start", "2026-06-15", TODAY))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 active:B",
			"2026-06-15 active:C",
		]);
	});

	it("is unbounded before the first record", () => {
		expect(stretchBounds(touching, "2026-06-01", "start", TODAY)?.min).toBeNull();
	});
});

describe("move", () => {
	it("slides a bounded stretch and its gap closer together", () => {
		const hist = h(["2026-06-10", "active", "B"], ["2026-06-20", "inactive"]);
		expect(show(applyStretchEdit(hist, "2026-06-10", "move", "2026-06-13", TODAY))).toEqual([
			"2026-06-13 active:B",
			"2026-06-23 inactive",
		]);
	});

	it("stops when it touches a neighbour, either side", () => {
		// B touches A on the left, and has a 5-day gap before C on the right.
		expect(stretchBounds(touching, "2026-06-10", "move", TODAY)).toEqual({
			min: "2026-06-10",
			max: "2026-06-15",
		});
		expect(show(applyStretchEdit(touching, "2026-06-10", "move", "2026-07-30", TODAY))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 inactive",
			"2026-06-15 active:B",
			"2026-06-25 active:C",
		]);
	});

	it("moving away from a touching right neighbour opens a gap before it", () => {
		expect(show(applyStretchEdit(touching, "2026-06-01", "move", "2026-05-28", TODAY))).toEqual([
			"2026-05-28 active:A",
			"2026-06-06 inactive",
			"2026-06-10 active:B",
			"2026-06-20 inactive",
			"2026-06-25 active:C",
		]);
	});

	it("moving left onto a gap's start touches the stretch before", () => {
		expect(stretchBounds(touching, "2026-06-25", "move", TODAY)).toEqual({
			min: "2026-06-20",
			max: null,
		});
		expect(show(applyStretchEdit(touching, "2026-06-25", "move", "2026-06-01", TODAY))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 active:B",
			"2026-06-20 active:C",
		]);
	});

	it("leaves an unknown stretch alone", () => {
		expect(applyStretchEdit(touching, "2026-06-20", "move", "2026-06-22", TODAY)).toEqual(touching);
	});
});

describe("split, merge and remove end", () => {
	it("splits strictly inside a stretch, carrying its intensity", () => {
		const hist: StatusRecord[] = [
			{ date: "2026-06-10", status: "active", note: "B", intensity: 3 },
			{ date: "2026-06-20", status: "inactive" },
		];
		expect(canSplitAt(hist, "2026-06-10", "2026-06-10")).toBe(false);
		expect(canSplitAt(hist, "2026-06-10", "2026-06-20")).toBe(false);
		expect(splitStretch(hist, "2026-06-10", "2026-06-15", "New intention")[1]).toEqual({
			date: "2026-06-15",
			status: "active",
			intensity: 3,
			note: "New intention",
		});
	});

	it("merges with a touching next stretch or across one gap", () => {
		expect(mergeableNext(touching, "2026-06-01")).toBe("2026-06-10");
		expect(show(mergeWithNext(touching, "2026-06-01"))).toEqual([
			"2026-06-01 active:A",
			"2026-06-20 inactive",
			"2026-06-25 active:C",
		]);
		expect(show(mergeWithNext(touching, "2026-06-10"))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 active:B",
		]);
		expect(mergeableNext(touching, "2026-06-25")).toBeNull();
	});

	it("removes an end only when it's a gap, never a neighbour's start", () => {
		expect(canRemoveEnd(touching, "2026-06-01")).toBe(false);
		expect(removeEnd(touching, "2026-06-01")).toEqual(touching);
		expect(canRemoveEnd(touching, "2026-06-10")).toBe(true);
		expect(show(removeEnd(touching, "2026-06-10"))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 active:B",
			"2026-06-25 active:C",
		]);
	});
});

describe("delete", () => {
	it("leaves a touching next stretch its start", () => {
		expect(show(deleteStretch(touching, "2026-06-01"))).toEqual([
			"2026-06-10 active:B",
			"2026-06-20 inactive",
			"2026-06-25 active:C",
		]);
	});

	it("keeps a touching previous stretch from running on", () => {
		expect(show(deleteStretch(touching, "2026-06-10"))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 inactive",
			"2026-06-25 active:C",
		]);
		expect(show(deleteStretch(touching, "2026-06-25"))).toEqual([
			"2026-06-01 active:A",
			"2026-06-10 active:B",
			"2026-06-20 inactive",
		]);
	});
});
