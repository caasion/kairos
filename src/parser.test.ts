import { describe, expect, it } from "vitest";
import { parseEndClock, parseSchedule, parseStartClock, parseTime } from "./parser";

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
		// From a midnight start, "00:00" is just zero (an empty range the caller rejects).
		expect(parseEndClock("00:00", 0)).toBe(0);
	});
});
