import { describe, expect, it } from "vitest";
import type { ISODate } from "../../types";
import {
	anchorFor,
	clampSpan,
	stepAnchor,
	windowDates,
	windowWidth,
} from "./weekWindow";

// Every (before, after) the sliders can produce is 1–7 on each side; these are
// the corners plus the default. Holos's column-count bug (caasion/holos#108)
// only showed up away from a 7-day window, so the asymmetric spans carry most
// of the weight here.
const SPANS: [before: number, after: number][] = [
	[1, 5], // the shipped default
	[1, 1], // narrowest
	[7, 7], // widest
	[7, 1], // mostly past
	[1, 7], // mostly future
	[3, 3], // symmetric
];

const TODAY: ISODate = "2026-07-25";

/** The window the view opens on for a given span, as rendered. */
function defaultWindow(today: ISODate, before: number, after: number) {
	const width = windowWidth(before, after);
	return windowDates(anchorFor(today, before), width);
}

describe("clampSpan", () => {
	it("passes through the 1–7 the sliders allow", () => {
		for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(clampSpan(n)).toBe(n);
	});

	it("clamps out-of-range values to the ends", () => {
		expect(clampSpan(0)).toBe(1);
		expect(clampSpan(-4)).toBe(1);
		expect(clampSpan(8)).toBe(7);
		expect(clampSpan(365)).toBe(7);
	});

	it("floors fractional values", () => {
		expect(clampSpan(3.9)).toBe(3);
	});

	it("falls back to 1 for a non-numeric stored value", () => {
		// A corrupt data.json used to reach the view as NaN, and NaN survived
		// Math.max/Math.min — the window then had zero columns.
		expect(clampSpan(NaN)).toBe(1);
		expect(clampSpan(Infinity)).toBe(7);
		expect(clampSpan(undefined as unknown as number)).toBe(1);
	});
});

describe("windowWidth", () => {
	it("is before + after + 1 — both sides plus today", () => {
		for (const [before, after] of SPANS) {
			expect(windowWidth(before, after)).toBe(before + after + 1);
		}
	});

	it("never exceeds 15 columns, even for absurd settings", () => {
		expect(windowWidth(99, 99)).toBe(15);
	});
});

describe("the default window", () => {
	it("renders exactly before + after + 1 columns at every span", () => {
		for (const [before, after] of SPANS) {
			expect(defaultWindow(TODAY, before, after)).toHaveLength(
				before + after + 1,
			);
		}
	});

	it("contains today at every span", () => {
		for (const [before, after] of SPANS) {
			expect(defaultWindow(TODAY, before, after)).toContain(TODAY);
		}
	});

	it("puts today exactly `before` days in, so the span reads as configured", () => {
		for (const [before, after] of SPANS) {
			const dates = defaultWindow(TODAY, before, after);
			expect(dates.indexOf(TODAY)).toBe(before);
			expect(dates[dates.length - 1 - after]).toBe(TODAY);
		}
	});

	it("spans [today − before, today + after]", () => {
		// before = 7, after = 1 on 2026-07-25 → Jul 18 through Jul 26.
		expect(defaultWindow(TODAY, 7, 1)).toEqual([
			"2026-07-18",
			"2026-07-19",
			"2026-07-20",
			"2026-07-21",
			"2026-07-22",
			"2026-07-23",
			"2026-07-24",
			"2026-07-25",
			"2026-07-26",
		]);
	});

	it("crosses a month boundary without losing a day", () => {
		expect(defaultWindow("2026-03-01", 3, 1)).toEqual([
			"2026-02-26",
			"2026-02-27",
			"2026-02-28",
			"2026-03-01",
			"2026-03-02",
		]);
	});

	it("crosses a year boundary without losing a day", () => {
		expect(defaultWindow("2026-01-02", 4, 1)).toEqual([
			"2025-12-29",
			"2025-12-30",
			"2025-12-31",
			"2026-01-01",
			"2026-01-02",
			"2026-01-03",
		]);
	});
});

describe("stepping the window", () => {
	it("makes consecutive windows abut — no day skipped, none repeated", () => {
		for (const [before, after] of SPANS) {
			const width = windowWidth(before, after);
			const start = anchorFor(TODAY, before);
			const run = [-1, 0, 1, 2].flatMap((steps) =>
				windowDates(stepAnchor(start, width, steps), width),
			);
			// One contiguous run of distinct days: each is the day after the last.
			expect(new Set(run).size).toBe(run.length);
			for (let i = 1; i < run.length; i++) {
				expect(run[i]).toBe(stepAnchor(run[i - 1]!, 1, 1));
			}
		}
	});

	it("returns to the same window after forward then back", () => {
		for (const [before, after] of SPANS) {
			const width = windowWidth(before, after);
			const start = anchorFor(TODAY, before);
			const roundTrip = stepAnchor(stepAnchor(start, width, 1), width, -1);
			expect(roundTrip).toBe(start);
		}
	});

	it("does not skip the day after today when stepping forward (holos#108)", () => {
		// The Holos report: a 6-column window on Jul 25 showed Jul 19–24, and
		// stepping forward jumped over the 25th to Jul 26–31. Kairos's window
		// already holds the 25th, and the next window starts the day after the
		// one it ends on.
		const [before, after] = [1, 4]; // six columns
		const width = windowWidth(before, after);
		const start = anchorFor(TODAY, before);
		expect(windowDates(start, width)).toEqual([
			"2026-07-24",
			"2026-07-25",
			"2026-07-26",
			"2026-07-27",
			"2026-07-28",
			"2026-07-29",
		]);
		expect(windowDates(stepAnchor(start, width, 1), width)).toEqual([
			"2026-07-30",
			"2026-07-31",
			"2026-08-01",
			"2026-08-02",
			"2026-08-03",
			"2026-08-04",
		]);
		expect(windowDates(stepAnchor(start, width, -1), width)).toEqual([
			"2026-07-18",
			"2026-07-19",
			"2026-07-20",
			"2026-07-21",
			"2026-07-22",
			"2026-07-23",
		]);
	});

	it("steps cleanly across a daylight-saving transition", () => {
		// 2026-03-08 is the US spring-forward; the dates are whole days, so the
		// missing hour must not shorten or double a column.
		const width = windowWidth(3, 3);
		const start = anchorFor("2026-03-08", 3);
		expect(windowDates(start, width)).toEqual([
			"2026-03-05",
			"2026-03-06",
			"2026-03-07",
			"2026-03-08",
			"2026-03-09",
			"2026-03-10",
			"2026-03-11",
		]);
		expect(windowDates(stepAnchor(start, width, 1), width)[0]).toBe(
			"2026-03-12",
		);
	});
});

describe("jumping to a date", () => {
	it("lands the picked day where today sits in the default window", () => {
		for (const [before, after] of SPANS) {
			const width = windowWidth(before, after);
			const picked: ISODate = "2026-11-03";
			const dates = windowDates(anchorFor(picked, before), width);
			expect(dates).toHaveLength(before + after + 1);
			expect(dates.indexOf(picked)).toBe(before);
		}
	});

	it("jumping to today reproduces the default window exactly", () => {
		for (const [before, after] of SPANS) {
			const width = windowWidth(before, after);
			expect(windowDates(anchorFor(TODAY, before), width)).toEqual(
				defaultWindow(TODAY, before, after),
			);
		}
	});
});
