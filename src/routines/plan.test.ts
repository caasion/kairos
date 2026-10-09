import { describe, expect, it } from "vitest";
import { manualMessage, planDayPrep, type PrepInput } from "./plan";
import { parseRoutines } from "./routinesFile";
import { routinesHash } from "./apply";
import { parseSchedule } from "../parser";
import { serialize } from "../serializer";
import type { Block } from "../types";

// 2026-10-05 Mon · 10-07 Wed · 10-08 Thu · 10-12 Mon.
const MON = "2026-10-05";
const WED = "2026-10-07";
const THU = "2026-10-08";
const NEXT_MON = "2026-10-12";
const PATH = "day.md";

// The routines file exactly as first written in the vault.
const USER_FILE = "# Mon, Wed\n- [ ] Noteworthy Rehearsal [Learning]";
const user = parseRoutines(USER_FILE);

const note = (body: string) => `## Schedule\n\n${body}\n`;
const blocksOf = (md: string, path = PATH) => parseSchedule(note(md), path);
const texts = (blocks: Block[]) => blocks.flatMap((b) => b.tasks.map((t) => t.text));

function input(over: Partial<PrepInput>): PrepInput {
	return {
		mode: "manual",
		date: WED,
		today: THU,
		path: PATH,
		blocks: [],
		carried: false,
		routines: user.routines,
		autoApply: true,
		...over,
	};
}

/** Write the plan to markdown and read it back, as the vault would. */
function roundTrip(blocks: Block[]): Block[] {
	return parseSchedule(serialize(blocks, "## Schedule"), PATH);
}

describe("the routines file as first written", () => {
	it("parses to one Mon/Wed task with no problems", () => {
		expect(user.problems).toEqual([]);
		expect(user.routines).toHaveLength(1);
		expect(user.routines[0]).toMatchObject({
			kind: "task",
			text: "Noteworthy Rehearsal",
			assoc: { kind: "project", id: "Learning" },
			rule: { kind: "weekly", days: [1, 3] },
		});
	});

	it("adds the task to Wednesday's real note, which has a block and an empty Unscheduled", () => {
		const wed = blocksOf("- 07:00 - 09:15 New block\n- Unscheduled");
		const plan = planDayPrep(input({ blocks: wed }));
		expect(plan.outcome).toBe("added");
		const inbox = roundTrip(plan.blocks).find((b) => b.title === "Unscheduled")!;
		expect(inbox.tasks.map((t) => `${t.text} ${t.assoc?.id}`)).toEqual([
			"Noteworthy Rehearsal Learning",
		]);
		expect(plan.frontmatter["kairos-routines"]).toBe(routinesHash(user.routines, WED));
	});

	it("says no routines are due on Thursday rather than 'already applied'", () => {
		const thu = blocksOf("- Unscheduled\n\t- [ ] New task [D:Builder]");
		const plan = planDayPrep(input({ date: THU, blocks: thu }));
		expect(plan.outcome).toBe("none-due");
		expect(plan.blocks).toBe(thu);
		expect(plan.frontmatter).toEqual({});
		expect(manualMessage(plan, THU, user, "Routines.md")).toBe(
			"No routines are due on Thu, Oct 8.",
		);
	});
});

describe("planDayPrep: the auto/manual table", () => {
	const hashMon = routinesHash(user.routines, NEXT_MON);

	it("auto never touches a past day", () => {
		const plan = planDayPrep(input({ mode: "auto", date: WED, today: THU }));
		expect(plan.outcome).toBe("past");
		expect(plan.added).toBe(0);
		expect(plan.frontmatter).toEqual({});
	});

	it("auto leaves routines alone when the setting is off, but still carries", () => {
		const prev = {
			date: WED,
			path: "wed.md",
			blocks: blocksOf("- Unscheduled\n\t- [ ] Leftover", "wed.md"),
		};
		const off = planDayPrep(
			input({ mode: "auto", date: THU, autoApply: false, previous: prev, routines: parseRoutines("## Daily\n- [ ] Read").routines }),
		);
		expect(off.outcome).toBe("off");
		expect(off.carried).toBe(1);
		expect(texts(off.blocks)).toEqual(["Leftover"]);
		expect(off.frontmatter).toEqual({ "kairos-carried": WED });
		// The command still applies regardless of the setting.
		expect(planDayPrep(input({ date: NEXT_MON, autoApply: false })).outcome).toBe("added");
	});

	it("auto applies to a future day with no key, and records the hash", () => {
		const plan = planDayPrep(input({ mode: "auto", date: NEXT_MON }));
		expect(plan.outcome).toBe("added");
		expect(texts(plan.blocks)).toEqual(["Noteworthy Rehearsal"]);
		expect(plan.frontmatter).toEqual({ "kairos-routines": hashMon });
	});

	it("auto does nothing when the recorded hash matches, even if the user deleted the task", () => {
		const plan = planDayPrep(input({ mode: "auto", date: NEXT_MON, recorded: hashMon }));
		expect(plan.outcome).toBe("recorded");
		expect(plan.added).toBe(0);
		expect(plan.frontmatter).toEqual({});
	});

	it("auto reports stale, without applying, when the hash differs", () => {
		const plan = planDayPrep(input({ mode: "auto", date: NEXT_MON, recorded: "old" }));
		expect(plan.outcome).toBe("stale");
		expect(plan.added).toBe(0);
		expect(plan.frontmatter).toEqual({});
	});

	it("manual re-applies over a matching hash, and writes nothing new", () => {
		const plan = planDayPrep(input({ date: NEXT_MON, recorded: hashMon }));
		expect(plan.outcome).toBe("added");
		expect(plan.frontmatter).toEqual({});
	});

	it("manual updates a stale hash", () => {
		const plan = planDayPrep(input({ date: NEXT_MON, recorded: "old" }));
		expect(plan.frontmatter).toEqual({ "kairos-routines": hashMon });
	});

	it("manual removes the key when a day no longer has any routines", () => {
		const plan = planDayPrep(input({ date: THU, recorded: "old" }));
		expect(plan.outcome).toBe("none-due");
		expect(plan.frontmatter).toEqual({ "kairos-routines": null });
	});

	it("manual works on a past day (the user asked for that day)", () => {
		expect(planDayPrep(input({ date: MON, today: THU })).outcome).toBe("added");
	});

	it("is idempotent through markdown: a second manual run adds nothing", () => {
		const first = planDayPrep(input({ date: NEXT_MON }));
		const second = planDayPrep(
			input({ date: NEXT_MON, blocks: roundTrip(first.blocks), recorded: hashMon }),
		);
		expect(second.outcome).toBe("present");
		expect(second.added).toBe(0);
		expect(manualMessage(second, NEXT_MON, user, "Routines.md")).toBe(
			"All 1 routine is already in Mon, Oct 12.",
		);
	});

	it("counts a done copy as present", () => {
		const done = blocksOf("- Unscheduled\n\t- [x] Noteworthy Rehearsal [Learning]");
		expect(planDayPrep(input({ date: NEXT_MON, blocks: done })).outcome).toBe("present");
	});
});

describe("planDayPrep: carry-over", () => {
	const yesterday = {
		date: WED,
		path: "wed.md",
		blocks: blocksOf(
			"- 09:00 - 10:00 Practice [Learning]\n\t- [ ] Scales\n\t- [x] Warm up\n- Unscheduled\n\t- [/] Half done\n\t- [-] Dropped",
			"wed.md",
		),
	};

	it("moves open and half-done tasks into today and records where from", () => {
		const plan = planDayPrep(input({ mode: "auto", date: THU, previous: yesterday }));
		expect(plan.carried).toBe(2);
		expect(texts(plan.blocks)).toEqual(["Scales", "Half done"]);
		expect(texts(plan.previous!.blocks)).toEqual(["Warm up", "Dropped"]);
		expect(plan.frontmatter["kairos-carried"]).toBe(WED);
		// The inherited association is written onto the moved line.
		const scales = plan.blocks.flatMap((b) => b.tasks).find((t) => t.text === "Scales")!;
		expect(scales.assoc).toEqual({ kind: "project", id: "Learning" });
	});

	it("doesn't carry twice into the same note", () => {
		const plan = planDayPrep(input({ mode: "auto", date: THU, previous: yesterday, carried: true }));
		expect(plan.carried).toBe(0);
		expect(plan.previous).toBeUndefined();
	});

	it("doesn't carry into a future day, or on a manual run", () => {
		expect(planDayPrep(input({ mode: "auto", date: NEXT_MON, previous: yesterday })).carried).toBe(0);
		expect(planDayPrep(input({ mode: "manual", date: THU, previous: yesterday })).carried).toBe(0);
	});

	it("carries even when routines were already recorded for today", () => {
		const plan = planDayPrep(
			input({ mode: "auto", date: THU, previous: yesterday, recorded: "x" }),
		);
		expect(plan.carried).toBe(2);
		expect(plan.outcome).toBe("stale");
	});

	it("doesn't stack a routine task on an open copy that carried in", () => {
		const daily = parseRoutines("## Daily\n- [ ] Noteworthy Rehearsal [Learning]").routines;
		const prev = {
			date: WED,
			path: "wed.md",
			blocks: blocksOf("- Unscheduled\n\t- [ ] Noteworthy Rehearsal [Learning]", "wed.md"),
		};
		const plan = planDayPrep(
			input({ mode: "auto", date: THU, previous: prev, routines: daily }),
		);
		expect(plan.carried).toBe(1);
		expect(plan.outcome).toBe("present");
		expect(texts(plan.blocks)).toEqual(["Noteworthy Rehearsal"]);
	});
});

describe("task matching across associations", () => {
	// An untagged routine homed in a block the user tagged in the day.
	const file = "## Daily\n- Night Routine\n\t- [ ] Journal";
	const routines = parseRoutines(file).routines;
	const day = blocksOf("- 22:00 - 23:00 Night Routine [D:Health]");

	it("doesn't add a second copy on re-apply when the home block carries a tag", () => {
		const first = planDayPrep(input({ date: THU, routines, blocks: day }));
		expect(first.added).toBe(1);
		const second = planDayPrep(input({ date: THU, routines, blocks: roundTrip(first.blocks) }));
		expect(second.added).toBe(0);
	});

	it("still adds a tagged routine when the day only has the same text under another tag", () => {
		const tagged = parseRoutines("## Daily\n- [ ] Read [D:School]").routines;
		const other = blocksOf("- Unscheduled\n\t- [ ] Read [D:Fun]");
		expect(planDayPrep(input({ date: THU, routines: tagged, blocks: other })).added).toBe(1);
	});
});

describe("manualMessage", () => {
	it("explains an empty or missing routines file", () => {
		const empty = parseRoutines("");
		const plan = planDayPrep(input({ routines: empty.routines }));
		expect(manualMessage(plan, WED, empty, "Routines.md")).toBe(
			"No routines found in Routines.md.",
		);
	});

	it("points at the first line Kairos couldn't use", () => {
		const bad = parseRoutines("# Mon, Wedd\n- [ ] Rehearsal");
		const plan = planDayPrep(input({ routines: bad.routines }));
		expect(manualMessage(plan, WED, bad, "Routines.md")).toBe(
			'No routines found in Routines.md. Routines.md has 1 line Kairos can\'t use (line 2: "Rehearsal" has no repeat rule).',
		);
	});
});
