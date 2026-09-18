import { describe, expect, it } from "vitest";
import type { Project, StatusRecord } from "../types";
import { appendStatus } from "../projectFile";
import { historyToSpans, noteToIntensity } from "./spans";
import {
	dateToX,
	daysBetween,
	getUnitViewport,
	getViewportWidth,
	isoWeekNumber,
	shiftDays,
	startOfQuarter,
	startOfWeek,
	stepUnit,
	unitLabel,
	unitRange,
	xToDate,
	xToDay,
} from "./ganttUtils";

const h = (
	...rs: [string, "active" | "inactive" | "archived", string?][]
): StatusRecord[] =>
	rs.map(([date, status, note]) => ({
		date: date,
		status,
		...(note ? { note } : {}),
	}));

describe("historyToSpans", () => {
	it("returns [] for an empty history (nothing recorded to draw)", () => {
		expect(historyToSpans([], "2026-08-05")).toEqual([]);
	});

	it("each record opens a span running to the next record's date", () => {
		const spans = historyToSpans(
			h(["2026-01-01", "active"], ["2026-03-01", "inactive"]),
			"2026-08-05",
		);
		expect(spans[0]).toMatchObject({ start: "2026-01-01", end: "2026-03-01", status: "active", open: false });
		expect(spans[1]).toMatchObject({ start: "2026-03-01", end: "2026-08-05", status: "inactive", open: true });
	});

	it("the trailing span is open and ends at today", () => {
		const spans = historyToSpans(h(["2026-01-01", "active"]), "2026-08-05");
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({ start: "2026-01-01", end: "2026-08-05", open: true });
	});

	it("clamps end to start when the trailing record is future-dated", () => {
		const spans = historyToSpans(h(["2026-12-01", "active"]), "2026-08-05");
		expect(spans[0]).toMatchObject({ start: "2026-12-01", end: "2026-12-01" });
	});

	it("carries the note and sets intensity only on active spans", () => {
		const spans = historyToSpans(
			h(["2026-01-01", "active", "hard"], ["2026-02-01", "inactive", "ignored"]),
			"2026-08-05",
		);
		expect(spans[0]?.note).toBe("hard");
		expect(spans[0]?.intensity).toBe(1);
		expect(spans[1]?.intensity).toBe(0); // non-active → no shading
	});

	it("sorts an out-of-order input defensively", () => {
		const spans = historyToSpans(
			h(["2026-03-01", "inactive"], ["2026-01-01", "active"]),
			"2026-08-05",
		);
		expect(spans.map((s) => s.start)).toEqual(["2026-01-01", "2026-03-01"]);
	});
});

describe("authoring active periods via the Gantt (compound edits)", () => {
	const project = (history: StatusRecord[]): Project => ({
		id: "p",
		name: "P",
		aliases: [],
		description: "",
		history,
		archived: false,
		source: { path: "P.md", line: 0 },
	});

	// The drag-to-create gesture writes `active` at A then `inactive` at B in one
	// entity (see setProjectActivePeriod). Compose the same pure edits here.
	const activePeriod = (p: Project, start: string, end: string, note?: string) =>
		appendStatus(
			appendStatus(p, start, "active", note),
			end,
			"inactive",
		);

	it("a bounded active period renders as one active span ending at its close", () => {
		const p = activePeriod(project([]), "2026-01-01", "2026-03-01", "hard");
		expect(p.history).toEqual([
			{ date: "2026-01-01", status: "active", note: "hard" },
			{ date: "2026-03-01", status: "inactive" },
		]);
		const spans = historyToSpans(p.history, "2026-08-05");
		const active = spans.filter((s) => s.status === "active");
		expect(active).toHaveLength(1);
		expect(active[0]).toMatchObject({ start: "2026-01-01", end: "2026-03-01", open: false });
	});

	it("a click-in-place (open-ended active) leaves the trailing span open", () => {
		const p = appendStatus(project([]), "2026-02-01", "active");
		const spans = historyToSpans(p.history, "2026-08-05");
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({ status: "active", open: true });
	});

	it("a new active period after an indefinite one is just a note-change boundary", () => {
		// | abc >  →  | abc | def >
		let p = appendStatus(project([]), "2026-01-01", "active", "abc");
		p = appendStatus(p, "2026-04-01", "active", "def");
		const active = historyToSpans(p.history, "2026-08-05").filter((s) => s.status === "active");
		expect(active.map((s) => [s.start, s.note])).toEqual([
			["2026-01-01", "abc"],
			["2026-04-01", "def"],
		]);
		// The earlier period is now bounded; the later one is still open-ended.
		expect(active[0]).toMatchObject({ end: "2026-04-01", open: false });
		expect(active[1]).toMatchObject({ open: true });
	});

	it("ending an indefinite bar inserts an inactive close (no new active span)", () => {
		let p = appendStatus(project([]), "2026-01-01", "active");
		p = appendStatus(p, "2026-05-01", "inactive");
		const spans = historyToSpans(p.history, "2026-08-05");
		expect(spans.filter((s) => s.status === "active")).toHaveLength(1);
		expect(spans.find((s) => s.status === "active")).toMatchObject({
			end: "2026-05-01",
			open: false,
		});
	});

	it("a distinct note lets an active-after-active boundary survive normalization", () => {
		// Clicking inside an existing (note-less) active span must NOT collapse: the
		// view seeds a differing note (`boundaryNote`) so the split is a real record.
		let p = appendStatus(project([]), "2026-01-01", "active");
		const same = appendStatus(p, "2026-04-01", "active");
		expect(same.history).toHaveLength(1); // identical transition collapsed away

		const distinct = appendStatus(p, "2026-04-01", "active", "baseline");
		expect(distinct.history).toHaveLength(2); // survives → the split boundary exists
		const active = historyToSpans(distinct.history, "2026-08-05");
		expect(active).toHaveLength(2);
		expect(active[0]).toMatchObject({ start: "2026-01-01", end: "2026-04-01", open: false });
		expect(active[1]).toMatchObject({ start: "2026-04-01", open: true });
	});
});

describe("noteToIntensity", () => {
	it("ramps known labels and is case-insensitive", () => {
		expect(noteToIntensity("taper")).toBeLessThan(noteToIntensity("baseline"));
		expect(noteToIntensity("baseline")).toBeLessThan(noteToIntensity("hard"));
		expect(noteToIntensity("HARD")).toBe(noteToIntensity("hard"));
	});
	it("falls back to a default for unknown/empty notes", () => {
		expect(noteToIntensity(undefined)).toBeGreaterThan(0);
		expect(noteToIntensity("something else")).toBe(noteToIntensity(undefined));
	});
});

describe("coordinate math", () => {
	it("daysBetween / shiftDays round-trip", () => {
		expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
		expect(shiftDays("2026-01-01", 30)).toBe("2026-01-31");
		expect(daysBetween("2026-03-01", "2026-01-01")).toBe(-59); // 2026 not leap
	});

	it("dateToX / xToDate invert each other (snap to day)", () => {
		const start = "2026-06-01";
		const pxPerDay = 12;
		for (const date of ["2026-06-01", "2026-06-15", "2026-07-01"]) {
			const x = dateToX(date, start, pxPerDay);
			expect(xToDate(x, start, pxPerDay)).toBe(date);
		}
	});

	it("xToDate rounds a mid-day pixel to the nearest day boundary", () => {
		expect(xToDate(17, "2026-06-01", 12)).toBe("2026-06-02"); // 17/12 ≈ 1.42 → +1 day
		expect(xToDate(19, "2026-06-01", 12)).toBe("2026-06-03"); // 19/12 ≈ 1.58 → +2 days
	});

	it("xToDay floors to the day-column the cursor is inside (for clicks)", () => {
		// Anywhere within a column maps to that column's day — no rounding-up to the
		// next boundary the way xToDate does for a left-half click.
		expect(xToDay(0, "2026-06-01", 12)).toBe("2026-06-01"); // left edge of day 0
		expect(xToDay(5, "2026-06-01", 12)).toBe("2026-06-01"); // left half → still day 0
		expect(xToDay(11, "2026-06-01", 12)).toBe("2026-06-01"); // right edge of day 0
		expect(xToDay(12, "2026-06-01", 12)).toBe("2026-06-02"); // into day 1
	});

	it("getViewportWidth counts both endpoints", () => {
		expect(getViewportWidth("2026-06-01", "2026-06-30", 10)).toBe(300); // 30 days * 10
	});
});

describe("calendar-unit intervals", () => {
	it("startOfWeek snaps to the Monday on-or-before (ISO weeks)", () => {
		expect(startOfWeek("2026-08-21")).toBe("2026-08-17"); // Fri → Mon of that week
		expect(startOfWeek("2026-08-17")).toBe("2026-08-17"); // a Monday is its own start
		expect(startOfWeek("2026-08-23")).toBe("2026-08-17"); // Sunday still belongs to Mon week
	});

	it("startOfQuarter snaps to Jan/Apr/Jul/Oct firsts", () => {
		expect(startOfQuarter("2026-08-21")).toBe("2026-07-01"); // Q3
		expect(startOfQuarter("2026-01-15")).toBe("2026-01-01"); // Q1
		expect(startOfQuarter("2026-12-31")).toBe("2026-10-01"); // Q4
	});

	it("unitRange returns whole inclusive calendar units", () => {
		expect(unitRange("week", "2026-08-21")).toEqual({ start: "2026-08-17", end: "2026-08-23" });
		expect(unitRange("month", "2026-08-21")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
		expect(unitRange("quarter", "2026-08-21")).toEqual({ start: "2026-07-01", end: "2026-09-30" });
		expect(unitRange("year", "2026-08-21")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
	});

	it("getUnitViewport mirrors unitRange", () => {
		expect(getUnitViewport("month", "2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
	});

	it("stepUnit advances/retreats by whole units", () => {
		expect(stepUnit("week", "2026-08-17", 1)).toBe("2026-08-24");
		expect(stepUnit("week", "2026-08-17", -1)).toBe("2026-08-10");
		expect(stepUnit("month", "2026-12-01", 1)).toBe("2027-01-01"); // year wrap
		expect(stepUnit("month", "2026-01-01", -1)).toBe("2025-12-01");
		expect(stepUnit("quarter", "2026-10-01", 1)).toBe("2027-01-01"); // Q4 → next Q1
		expect(stepUnit("quarter", "2026-01-01", -1)).toBe("2025-10-01");
		expect(stepUnit("year", "2026-01-01", 1)).toBe("2027-01-01");
	});

	it("isoWeekNumber follows ISO-8601 (Thursday rule)", () => {
		// 2026-01-01 is a Thursday → it belongs to week 1 of 2026.
		expect(isoWeekNumber("2026-01-01")).toBe(1);
		expect(isoWeekNumber("2026-01-05")).toBe(2); // the following Monday
		// A date in a mid-year week.
		expect(isoWeekNumber("2026-08-21")).toBe(34);
		// 2025-12-29 (Mon) starts the week containing 2026-01-01 (Thu) → week 1/2026.
		expect(isoWeekNumber("2025-12-29")).toBe(1);
	});

	it("unitLabel is human-readable per interval", () => {
		expect(unitLabel("month", "2026-08-01")).toBe("Aug 2026");
		expect(unitLabel("quarter", "2026-07-01")).toBe("Q3 2026");
		expect(unitLabel("year", "2026-01-01")).toBe("2026");
	});
});
