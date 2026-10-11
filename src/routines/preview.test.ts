import { describe, expect, it } from "vitest";
import {
	UNASSIGNED_ROW,
	bucketByRow,
	missingRoutines,
	previewRoutines,
	routineKey,
	showsPreviews,
} from "./preview";
import { applyRoutines, routinesHash } from "./apply";
import { parseRoutines, type Routine } from "./routinesFile";
import { parseSchedule } from "../parser";
import type { Association } from "../types";

// 2026-10-07 Wed · 10-08 Thu · 10-12 Mon.
const WED = "2026-10-07";
const THU = "2026-10-08";
const MON = "2026-10-12";
const PATH = "day.md";

const FILE = `## Mon, Wed
- [ ] Noteworthy Rehearsal [Learning]
- 07:30 - 08:00 Morning Routine [D:Health]
	- [ ] Take meds
## Daily
- [ ] Water the plants
- Night Routine
	- [ ] Journal [D:Health]
`;
const { routines } = parseRoutines(FILE);
const blocksOf = (md: string) => parseSchedule(`## Schedule\n\n${md}\n`, PATH);
const names = (rs: Routine[]) => rs.map((r) => (r.kind === "block" ? r.title : r.text));

describe("missingRoutines", () => {
	it("lists everything due on an empty day", () => {
		expect(names(missingRoutines([], routines, MON))).toEqual([
			"Noteworthy Rehearsal",
			"Morning Routine",
			"Take meds",
			"Water the plants",
			"Journal",
		]);
	});

	it("lists only what's due that weekday", () => {
		expect(names(missingRoutines([], routines, THU))).toEqual(["Water the plants", "Journal"]);
	});

	it("drops what the day already has, whatever its status or block", () => {
		const day = blocksOf(
			"- 07:30 - 08:00 Morning Routine [D:Health]\n- 21:00 - 22:00 Wind down\n\t- [x] Water the plants",
		);
		expect(names(missingRoutines(day, routines, MON))).toEqual([
			"Noteworthy Rehearsal",
			"Take meds",
			"Journal",
		]);
	});

	it("doesn't list a block routine moved to another time", () => {
		const day = blocksOf("- 09:00 - 09:30 Morning Routine [D:Health]");
		expect(names(missingRoutines(day, routines, MON))).not.toContain("Morning Routine");
	});

	it("is empty once every routine has been applied", () => {
		const applied = applyRoutines([], routines, MON, PATH).blocks;
		expect(missingRoutines(applied, routines, MON)).toEqual([]);
	});
});

describe("showsPreviews: the visibility table", () => {
	const hash = routinesHash(routines, MON);

	it("never for a past day", () => {
		expect(showsPreviews({ date: WED, today: THU, routines })).toBe(false);
	});

	it("for today and future days that were never set up", () => {
		expect(showsPreviews({ date: THU, today: THU, routines })).toBe(true);
		expect(showsPreviews({ date: MON, today: THU, routines })).toBe(true);
	});

	it("not when the recorded hash matches — missing items were deleted on purpose", () => {
		expect(showsPreviews({ date: MON, today: THU, recorded: hash, routines })).toBe(false);
	});

	it("again when the routines changed since the day was set up", () => {
		expect(showsPreviews({ date: MON, today: THU, recorded: "old", routines })).toBe(true);
	});

	it("previewRoutines returns nothing for a set-up day even with items missing", () => {
		expect(
			previewRoutines({ date: MON, today: THU, recorded: hash, routines, blocks: [] }),
		).toEqual([]);
		expect(
			previewRoutines({ date: MON, today: THU, recorded: "old", routines, blocks: [] }),
		).toHaveLength(5);
	});
});

describe("bucketByRow", () => {
	const rowKeyFor = (a: Association) =>
		a.kind === "domain" && a.id === "Health" ? "domain:Health" : undefined;

	it("files tasks by their own or inherited association, blocks by theirs", () => {
		const buckets = bucketByRow(missingRoutines([], routines, MON), rowKeyFor);
		expect(names(buckets.get("domain:Health") ?? [])).toEqual([
			"Morning Routine",
			"Take meds",
			"Journal",
		]);
	});

	it("puts untagged routines and ones with no row in Unassigned", () => {
		const buckets = bucketByRow(missingRoutines([], routines, MON), rowKeyFor);
		// [Learning] has no row in this window; Water the plants has no tag.
		expect(names(buckets.get(UNASSIGNED_ROW) ?? [])).toEqual([
			"Noteworthy Rehearsal",
			"Water the plants",
		]);
	});

	it("gives every routine a distinct key", () => {
		const keys = routines.map(routineKey);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
