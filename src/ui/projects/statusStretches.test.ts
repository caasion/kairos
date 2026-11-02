import { describe, expect, it } from "vitest";
import type { StatusRecord } from "../../types";
import { formatSpan, stretchesOf, stripOf } from "./statusStretches";

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
