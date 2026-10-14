import { describe, expect, it } from "vitest";
import {
	formatClock,
	formatTimeRange,
	parseEndClock,
	parseSchedule,
	parseStartClock,
	parseTime,
	parseTimeRangeText,
} from "./parser";

describe("parseTime", () => {
	it("reads an ordinary range", () => {
		expect(parseTime("09:00 - 10:30 Work")).toEqual({
			range: { start: 540, end: 630 },
			title: "Work",
		});
		expect(parseTime("00:00 - 01:00 Early")?.range).toEqual({ start: 0, end: 60 });
	});

	it("reads an end of 24:00 as midnight", () => {
		expect(parseTime("22:00 - 24:00 Sleep")).toEqual({
			range: { start: 1320, end: 1440 },
			title: "Sleep",
		});
	});

	it("reads an end of 00:00 after a later start as midnight", () => {
		expect(parseTime("23:00 - 00:00 Sleep")?.range).toEqual({ start: 1380, end: 1440 });
	});

	it("still rejects ranges that aren't a forward span within the day", () => {
		expect(parseTime("22:00 - 24:30 X")).toBeUndefined();
		expect(parseTime("24:00 - 24:00 X")).toBeUndefined();
		expect(parseTime("24:00 - 01:00 X")).toBeUndefined();
		expect(parseTime("00:00 - 00:00 X")).toBeUndefined();
		expect(parseTime("10:00 - 09:00 X")).toBeUndefined();
		expect(parseTime("25:00 - 26:00 X")).toBeUndefined();
	});
});

describe("parseSchedule with a block ending at midnight", () => {
	it("keeps the block timed and its title clean", () => {
		const md = "## Schedule\n\n- [ ] 22:00 - 24:00 Late [Proj]\n\t- [ ] sub\n";
		const [block] = parseSchedule(md, "x");
		expect(block?.scheduled).toBe(true);
		expect(block?.time).toEqual({ start: 1320, end: 1440 });
		expect(block?.title).toBe("Late");
		expect(block?.status).toBe(" ");
		expect(block?.tasks.map((t) => t.text)).toEqual(["sub"]);
	});
});

describe("clock inputs", () => {
	it("parses a start time within the day", () => {
		expect(parseStartClock("00:00")).toBe(0);
		expect(parseStartClock("23:59")).toBe(1439);
		expect(parseStartClock("24:00")).toBeUndefined();
		expect(parseStartClock("9:5")).toBeUndefined();
	});

	it("parses an end time, reading midnight as 1440", () => {
		expect(parseEndClock("10:00", 540)).toBe(600);
		expect(parseEndClock("00:00", 1380)).toBe(1440);
		expect(parseEndClock("24:00", 1380)).toBe(1440);
		expect(parseEndClock("24:30", 1380)).toBeUndefined();
		// From a midnight start too: an editor can't show "24:00", so a whole
		// day reads 00:00 to 00:00.
		expect(parseEndClock("00:00", 0)).toBe(1440);
		expect(parseEndClock("24:00", 0)).toBe(1440);
		expect(parseEndClock("0:00", 0)).toBe(1440);
	});

	it("still rejects an empty 00:00 - 00:00 range in a note", () => {
		expect(parseTime("00:00 - 00:00 Nothing")).toBeUndefined();
		expect(parseTime("00:00 - 24:00 All day")?.range).toEqual({ start: 0, end: 1440 });
	});
});

describe("parseTimeRangeText", () => {
	const ok = (start: number, end: number) => ({ ok: true, range: { start, end } });
	const error = (text: string) => {
		const r = parseTimeRangeText(text);
		return r.ok ? undefined : r.error;
	};

	it("reads a range with a hyphen, en dash or em dash, spaced or not", () => {
		expect(parseTimeRangeText("9:00 - 10:30")).toEqual(ok(540, 630));
		expect(parseTimeRangeText("09:00–10:30")).toEqual(ok(540, 630));
		expect(parseTimeRangeText("09:00 — 10:30")).toEqual(ok(540, 630));
		expect(parseTimeRangeText("9:00-10:30")).toEqual(ok(540, 630));
		expect(parseTimeRangeText("  09:00 -10:30  ")).toEqual(ok(540, 630));
		expect(parseTimeRangeText("00:00 - 00:01")).toEqual(ok(0, 1));
		expect(parseTimeRangeText("23:59 - 24:00")).toEqual(ok(1439, 1440));
	});

	it("reads an end at midnight written 24:00 or 00:00", () => {
		expect(parseTimeRangeText("22:00 - 24:00")).toEqual(ok(1320, 1440));
		expect(parseTimeRangeText("22:00 - 00:00")).toEqual(ok(1320, 1440));
		expect(parseTimeRangeText("22:00 - 0:00")).toEqual(ok(1320, 1440));
		// A whole day, as parseEndClock reads it.
		expect(parseTimeRangeText("00:00 - 00:00")).toEqual(ok(0, 1440));
		expect(parseTimeRangeText("00:00 - 24:00")).toEqual(ok(0, 1440));
	});

	it("rejects text that isn't two HH:MM times", () => {
		for (const text of [
			"",
			"   ",
			"9 - 10",
			"9:00",
			"9:00 - ",
			"9:5 - 10:00",
			"09:00 to 10:00",
			"09:00 - 10:00 Work",
			"9.00 - 10.00",
			"-1:00 - 2:00",
			"123:00 - 124:00",
			"9:00 -- 10:00",
			"9:00 am - 10:00 am",
		]) {
			expect(error(text), text).toBe("Write the time like 09:00 - 10:30.");
		}
	});

	it("rejects minutes past 59", () => {
		expect(error("09:60 - 10:00")).toBe("Minutes go up to 59.");
		expect(error("09:00 - 10:75")).toBe("Minutes go up to 59.");
		expect(error("23:99 - 24:00")).toBe("Minutes go up to 59.");
	});

	it("rejects a start of 24:00 or later", () => {
		expect(error("24:00 - 24:00")).toBe("The start must be before 24:00.");
		expect(error("25:00 - 26:00")).toBe("The start must be before 24:00.");
		expect(error("99:00 - 10:00")).toBe("The start must be before 24:00.");
	});

	it("rejects an end past 24:00", () => {
		expect(error("22:00 - 24:30")).toBe("The end can't be after 24:00.");
		expect(error("22:00 - 25:00")).toBe("The end can't be after 24:00.");
	});

	it("rejects an end that isn't after the start", () => {
		expect(error("10:00 - 09:00")).toBe("The end must be after the start.");
		expect(error("10:00 - 10:00")).toBe("The end must be after the start.");
		expect(error("10:00 - 01:00")).toBe("The end must be after the start.");
	});

	it("takes every range a note's time does", () => {
		for (const text of ["09:00 - 10:30", "22:00 - 24:00", "23:00 - 00:00", "00:00 - 01:00"]) {
			const fromNote = parseTime(`${text} Work`)?.range;
			expect(fromNote, text).toBeDefined();
			expect(parseTimeRangeText(text)).toEqual({ ok: true, range: fromNote });
		}
	});
});

describe("formatting a time", () => {
	it("zero-pads a clock and writes the end of the day as 24:00", () => {
		expect(formatClock(0)).toBe("00:00");
		expect(formatClock(545)).toBe("09:05");
		expect(formatClock(1439)).toBe("23:59");
		expect(formatClock(1440)).toBe("24:00");
	});

	it("formats a range that reads back unchanged", () => {
		expect(formatTimeRange({ start: 540, end: 630 })).toBe("09:00–10:30");
		expect(formatTimeRange({ start: 540, end: 630 }, " - ")).toBe("09:00 - 10:30");
		for (const range of [{ start: 0, end: 1440 }, { start: 1320, end: 1440 }, { start: 5, end: 6 }]) {
			expect(parseTimeRangeText(formatTimeRange(range))).toEqual({ ok: true, range });
		}
	});
});
