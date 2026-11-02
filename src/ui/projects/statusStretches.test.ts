import { describe, expect, it } from "vitest";
import type { StatusRecord } from "../../types";
import {
	changeBounds,
	clampChange,
	formatSpan,
	stretchesOf,
	stripOf,
	stripSpan,
	withChangeMoved,
} from "./statusStretches";

const history: StatusRecord[] = [
	{ date: "2026-08-04", status: "active", why: "New semester", intensity: 3 },
	{ date: "2026-01-10", status: "active" },
	{ date: "2026-06-01", status: "inactive", note: "Summer job" },
];

describe("stretchesOf", () => {
	it("orders records oldest first and pairs each with the one before", () => {
		const s = stretchesOf(history, "2026-11-01");
		expect(s.map((x) => x.start)).toEqual(["2026-01-10", "2026-06-01", "2026-08-04"]);
		expect(s[0]?.prev).toBeUndefined();
		expect(s[2]?.prev?.status).toBe("inactive");
	});

	it("ends each stretch at the next record and runs the last on to today", () => {
		const s = stretchesOf(history, "2026-11-01");
		expect(s[1]?.end).toBe("2026-08-04");
		expect(s[1]?.days).toBe(64);
		expect(s[2]?.end).toBeUndefined();
		expect(s[2]?.days).toBe(90); // Aug 4 to Nov 1, both days counted
		expect(s.map((x) => x.current)).toEqual([false, false, true]);
	});

	it("marks a scheduled record as future, and the one before it as current", () => {
		const s = stretchesOf([...history, { date: "2026-12-01", status: "inactive" }], "2026-11-01");
		expect(s.at(-1)?.future).toBe(true);
		expect(s.at(-1)?.days).toBe(0);
		expect(s.at(-2)?.current).toBe(true);
	});
});

describe("formatSpan", () => {
	it("counts days, then months, then years", () => {
		expect(formatSpan(1)).toBe("1 day");
		expect(formatSpan(30)).toBe("30 days");
		expect(formatSpan(90)).toBe("3 mo");
		expect(formatSpan(365)).toBe("1 yr");
		expect(formatSpan(430)).toBe("1 yr 2 mo");
	});
});

describe("stripOf", () => {
	it("lays the stretches end to end, to scale, filling the strip", () => {
		const parts = stripOf(stretchesOf(history, "2026-11-01"), "2026-11-01");
		expect(parts[0]?.left).toBe(0);
		const total = parts.reduce((sum, p) => sum + p.width, 0);
		expect(total).toBeCloseTo(1);
		expect(parts[1]!.left).toBeCloseTo(parts[0]!.width);
	});

	it("is empty with no history", () => {
		expect(stripOf([], "2026-11-01")).toEqual([]);
	});
});

describe("moving a change", () => {
	it("stays between its neighbours", () => {
		expect(changeBounds(history, "2026-06-01", "2026-11-01")).toEqual({
			min: "2026-01-11",
			max: "2026-08-03",
		});
	});

	it("is open before the first change, and runs to today after the last", () => {
		expect(changeBounds(history, "2026-01-10", "2026-11-01").min).toBeUndefined();
		expect(changeBounds(history, "2026-08-04", "2026-11-01").max).toBe("2026-11-01");
	});

	it("lets a scheduled last change stay where it is", () => {
		const later = [...history, { date: "2026-12-01", status: "inactive" as const }];
		expect(changeBounds(later, "2026-12-01", "2026-11-01").max).toBe("2026-12-01");
	});

	it("clamps a drag into the bounds", () => {
		const b = { min: "2026-01-11", max: "2026-08-03" };
		expect(clampChange("2026-01-01", b)).toBe("2026-01-11");
		expect(clampChange("2026-09-01", b)).toBe("2026-08-03");
		expect(clampChange("2026-05-05", b)).toBe("2026-05-05");
	});

	it("previews the move without touching the others", () => {
		const moved = withChangeMoved(history, "2026-06-01", "2026-05-20");
		expect(moved.map((r) => r.date).sort()).toEqual(["2026-01-10", "2026-05-20", "2026-08-04"]);
		expect(moved.find((r) => r.date === "2026-05-20")?.note).toBe("Summer job");
	});

	it("measures the strip from the first change to today", () => {
		expect(stripSpan(stretchesOf(history, "2026-11-01"), "2026-11-01")).toEqual({
			start: "2026-01-10",
			days: 296,
		});
	});
});
