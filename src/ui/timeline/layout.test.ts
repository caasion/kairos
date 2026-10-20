import { describe, expect, it } from "vitest";
import { dropRange, type TimelineGeometry } from "./layout";
import { parseSchedule } from "../../parser";
import { serialize } from "../../serializer";

const geo: TimelineGeometry = { startHour: 6, endHour: 24, hourHeight: 60, topPad: 8 };

describe("dropRange", () => {
	it("snaps the start to the grid and lasts 30 minutes", () => {
		expect(dropRange(14 * 60 + 2, geo)).toEqual({ start: 840, end: 870 });
		expect(dropRange(14 * 60 + 3, geo)).toEqual({ start: 845, end: 875 });
	});

	it("never starts before the first visible hour", () => {
		expect(dropRange(5 * 60, geo)).toEqual({ start: 360, end: 390 });
	});

	it("shifts earlier rather than running past the last hour", () => {
		expect(dropRange(23 * 60 + 50, geo)).toEqual({ start: 1410, end: 1440 });
	});

	it("gives a range at the end of the day that survives a write and reparse", () => {
		const time = dropRange(23 * 60 + 50, geo);
		const md = serialize([
			{ source: { path: "x", line: -1 }, title: "Late", scheduled: true, time, tasks: [] },
		]);
		expect(parseSchedule(md, "x")[0]?.time).toEqual(time);
	});

	it("fits a day shorter than the block", () => {
		const short: TimelineGeometry = { ...geo, startHour: 9, endHour: 10 };
		expect(dropRange(9 * 60 + 40, short, 90)).toEqual({ start: 540, end: 600 });
	});
});
