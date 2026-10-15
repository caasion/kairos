import { describe, expect, it } from "vitest";
import {
	scheduleInNewBlock,
	RoutinesConflict,
	addRoutine,
	draftOf,
	removeRoutine,
	updateRoutine,
	type RoutineDraft,
} from "./routinesWriter";
import { parseRoutines, type Routine } from "./routinesFile";
import { compareRules, parseRule, ruleText, type Rule } from "./rules";

const FILE = `---
tags: [kairos]
---

Some notes I keep at the top.

## Weekdays
- 07:30 - 08:00 Morning Routine
	- [ ] Take meds
	- [ ] Stretch 🔁 daily
- [ ] 18:00 - 19:00 Gym [Fitness] 🔁 Tue, Thu

## Daily
- [ ] Water the plants [D:Home]
- Night Routine [D:Health]
	- [ ] Journal

## Notes
Free text that isn't a routine.
`;

const rule = (text: string): Rule => parseRule(text)!;
const routines = (md: string) => parseRoutines(md).routines;
const find = (md: string, name: string): Routine => {
	const r = routines(md).find((x) => (x.kind === "block" ? x.title : x.text) === name);
	if (!r) throw new Error(`no routine ${name}`);
	return r;
};
const lines = (md: string) => md.split("\n");
const taskDraft = (r: Routine) => draftOf(r) as Extract<RoutineDraft, { kind: "task" }>;

/** Lines of `before` that aren't in `after` and vice versa (a cheap diff). */
function changed(before: string, after: string) {
	const a = lines(before);
	const b = lines(after);
	return {
		removed: a.filter((l) => !b.includes(l)),
		added: b.filter((l) => !a.includes(l)),
	};
}

describe("ruleText", () => {
	it.each([
		["daily", "Daily"],
		["every weekday", "Weekdays"],
		["weekends", "Weekends"],
		["Wednesday and Monday", "Mon, Wed"],
		["sun, sat, fri", "Fri, Sat, Sun"],
		["monthly on the 1st", "Monthly on 1"],
	])("%s → %s, and parses back to the same rule", (input, text) => {
		const r = rule(input);
		expect(ruleText(r)).toBe(text);
		expect(parseRule(ruleText(r))).toEqual(r);
	});

	it("orders groups Daily, Weekdays, Weekends, day lists, monthly", () => {
		const order = ["Monthly on 15", "Tue", "Weekends", "Mon, Wed", "Daily", "Mon", "Monthly on 1", "Weekdays", "Sun"]
			.map(rule)
			.sort(compareRules)
			.map(ruleText);
		expect(order).toEqual([
			"Daily",
			"Weekdays",
			"Weekends",
			"Mon",
			"Mon, Wed",
			"Tue",
			"Sun",
			"Monthly on 1",
			"Monthly on 15",
		]);
	});
});

describe("updateRoutine in place", () => {
	it("re-renders only the routine's own line", () => {
		const water = find(FILE, "Water the plants");
		const next = updateRoutine(FILE, water, { ...taskDraft(water), text: "Water the ferns" });
		expect(changed(FILE, next)).toEqual({
			removed: ["- [ ] Water the plants [D:Home]"],
			added: ["- [ ] Water the ferns [D:Home]"],
		});
		expect(find(next, "Water the ferns")).toMatchObject({ assoc: { kind: "domain", id: "Home" } });
	});

	it("keeps a nested task's indent and its 🔁 override", () => {
		const stretch = find(FILE, "Stretch");
		const next = updateRoutine(FILE, stretch, { ...taskDraft(stretch), text: "Stretch longer" });
		expect(changed(FILE, next).added).toEqual(["\t- [ ] Stretch longer 🔁 Daily"]);
		expect(find(next, "Stretch longer")).toMatchObject({ home: "Morning Routine", rule: rule("daily") });
	});

	it("retimes a block without touching its tasks", () => {
		const morning = find(FILE, "Morning Routine");
		const draft = draftOf(morning);
		if (draft.kind !== "block") throw new Error();
		const next = updateRoutine(FILE, morning, { ...draft, time: { start: 420, end: 450 } });
		expect(changed(FILE, next)).toEqual({
			removed: ["- 07:30 - 08:00 Morning Routine"],
			added: ["- 07:00 - 07:30 Morning Routine"],
		});
	});

	it("retimes a block to end at midnight and reads it back", () => {
		const morning = find(FILE, "Morning Routine");
		const draft = draftOf(morning);
		if (draft.kind !== "block") throw new Error();
		const next = updateRoutine(FILE, morning, { ...draft, time: { start: 1380, end: 1440 } });
		expect(changed(FILE, next).added).toEqual(["- 23:00 - 24:00 Morning Routine"]);
		expect(find(next, "Morning Routine")).toMatchObject({ time: { start: 1380, end: 1440 } });
	});

	it("rewrites a legacy checkbox block routine without the checkbox when edited", () => {
		const gym = find(FILE, "Gym");
		const draft = draftOf(gym);
		if (draft.kind !== "block") throw new Error();
		const next = updateRoutine(FILE, gym, { ...draft, time: { start: 1020, end: 1080 } });
		expect(changed(FILE, next)).toEqual({
			removed: ["- [ ] 18:00 - 19:00 Gym [Fitness] 🔁 Tue, Thu"],
			added: ["- 17:00 - 18:00 Gym [Fitness] 🔁 Tue, Thu"],
		});
		expect(find(next, "Gym")).toMatchObject({ kind: "block", time: { start: 1020, end: 1080 } });
	});

	it("sets and clears an association", () => {
		const water = find(FILE, "Water the plants");
		const { assoc: _drop, ...bare } = draftOf(water) as Extract<RoutineDraft, { kind: "task" }>;
		const cleared = updateRoutine(FILE, water, bare);
		expect(changed(FILE, cleared).added).toEqual(["- [ ] Water the plants"]);
	});
});

describe("updateRoutine moving to another rule", () => {
	it("moves a task under an existing heading of that rule", () => {
		const water = find(FILE, "Water the plants");
		const next = updateRoutine(FILE, water, { ...draftOf(water), rule: rule("weekdays") });
		expect(find(next, "Water the plants").rule).toEqual(rule("weekdays"));
		const weekdays = lines(next).indexOf("## Weekdays");
		const daily = lines(next).indexOf("## Daily");
		const at = lines(next).indexOf("- [ ] Water the plants [D:Home]");
		expect(at).toBeGreaterThan(weekdays);
		expect(at).toBeLessThan(daily);
	});

	it("creates a canonical heading at the end when none matches", () => {
		const water = find(FILE, "Water the plants");
		const next = updateRoutine(FILE, water, { ...draftOf(water), rule: rule("monthly on 3") });
		expect(next.endsWith("## Monthly on 3\n- [ ] Water the plants [D:Home]\n")).toBe(true);
		// Everything else is still there, in order.
		expect(lines(next).slice(0, 5)).toEqual(lines(FILE).slice(0, 5));
		expect(next).toContain("Free text that isn't a routine.\n\n## Monthly on 3");
	});

	it("moves a block together with its nested tasks", () => {
		const morning = find(FILE, "Morning Routine");
		const next = updateRoutine(FILE, morning, { ...draftOf(morning), rule: rule("daily") });
		const meds = find(next, "Take meds");
		expect(meds).toMatchObject({ home: "Morning Routine", rule: rule("daily") });
		expect(find(next, "Morning Routine").rule).toEqual(rule("daily"));
		// Gym stays put under Weekdays.
		expect(find(next, "Gym").rule).toEqual(rule("tue, thu"));
	});

	it("moves a homed task by changing its home", () => {
		const journal = find(FILE, "Journal");
		const next = updateRoutine(FILE, journal, { ...taskDraft(journal), home: "Morning Routine", rule: rule("weekdays") });
		expect(find(next, "Journal")).toMatchObject({ home: "Morning Routine", rule: rule("weekdays") });
		// The Night Routine home is left with nothing under it, so it goes.
		expect(next).not.toContain("Night Routine");
	});
});

describe("removeRoutine", () => {
	it("removes a task line and nothing else", () => {
		const next = removeRoutine(FILE, find(FILE, "Water the plants"));
		expect(changed(FILE, next)).toEqual({ removed: ["- [ ] Water the plants [D:Home]"], added: [] });
	});

	it("removes a block with its nested tasks", () => {
		const next = removeRoutine(FILE, find(FILE, "Morning Routine"));
		expect(changed(FILE, next).removed).toEqual([
			"- 07:30 - 08:00 Morning Routine",
			"\t- [ ] Take meds",
			"\t- [ ] Stretch 🔁 daily",
		]);
		expect(routines(next).map((r) => (r.kind === "block" ? r.title : r.text))).toEqual([
			"Gym",
			"Water the plants",
			"Journal",
		]);
	});

	it("drops a home line once its last task is gone, but keeps a block", () => {
		const noJournal = removeRoutine(FILE, find(FILE, "Journal"));
		expect(noJournal).not.toContain("Night Routine");
		const noMeds = removeRoutine(FILE, find(FILE, "Take meds"));
		expect(noMeds).toContain("Morning Routine");
	});

	it("drops a rule heading once its last routine is gone", () => {
		const md = "# Mon, Wed\n- [ ] Rehearsal\n\n## Weekdays\n- [ ] Probe\n\n## Weekends\n- [ ] Other\n";
		const next = removeRoutine(md, find(md, "Probe"));
		expect(next).toBe("# Mon, Wed\n- [ ] Rehearsal\n\n## Weekends\n- [ ] Other\n");
		const last = removeRoutine(next, find(next, "Other"));
		expect(last).toBe("# Mon, Wed\n- [ ] Rehearsal\n");
	});

	it("keeps a rule heading that still has prose, and any heading that isn't a rule", () => {
		const withNote = "## Weekdays\nMy weekday stuff.\n- [ ] Probe\n";
		expect(removeRoutine(withNote, find(withNote, "Probe"))).toBe("## Weekdays\nMy weekday stuff.\n");
		const notes = "## Notes\n🔁 none here\n\n## Daily\n- [ ] Read\n";
		expect(removeRoutine(notes, find(notes, "Read"))).toBe("## Notes\n🔁 none here\n");
	});

	it("drops the old heading when its only block moves to another rule", () => {
		const md = "## Weekdays\n- 07:00 - 08:00 Gym\n\t- [ ] Stretch\n";
		const gym = find(md, "Gym");
		const next = updateRoutine(md, gym, { ...(draftOf(gym) as Extract<RoutineDraft, { kind: "block" }>), rule: rule("weekends") });
		expect(next).toBe("## Weekends\n- 07:00 - 08:00 Gym\n\t- [ ] Stretch\n");
	});

	it("refuses to edit when the line no longer holds that routine", () => {
		const water = find(FILE, "Water the plants");
		const shifted = "New line at the top\n" + FILE;
		expect(() => removeRoutine(shifted, water)).toThrow(RoutinesConflict);
		expect(() => updateRoutine(shifted, water, draftOf(water))).toThrow(RoutinesConflict);
	});
});

describe("addRoutine", () => {
	it("appends under a heading spelled differently but meaning the same rule", () => {
		const md = "## Monday and Wednesday\n- [ ] Rehearsal\n\n## Daily\n- [ ] Read\n";
		const next = addRoutine(md, { kind: "task", rule: rule("Mon, Wed"), text: "Sing" });
		expect(next).toBe("## Monday and Wednesday\n- [ ] Rehearsal\n- [ ] Sing\n\n## Daily\n- [ ] Read\n");
	});

	it("adds a block with time and association", () => {
		const next = addRoutine("", {
			kind: "block",
			rule: rule("tue, thu"),
			title: "Gym",
			time: { start: 1080, end: 1140 },
			assoc: { kind: "project", id: "Fitness" },
		});
		expect(next).toBe("## Tue, Thu\n- 18:00 - 19:00 Gym [Fitness]\n");
		expect(find(next, "Gym")).toMatchObject({ time: { start: 1080, end: 1140 } });
	});

	it("nests a homed task under the section's block of that title", () => {
		const next = addRoutine(FILE, { kind: "task", rule: rule("weekdays"), text: "Vitamins", home: "Morning Routine" });
		const l = lines(next);
		expect(l[l.indexOf("\t- [ ] Stretch 🔁 daily") + 1]).toBe("\t- [ ] Vitamins");
		expect(find(next, "Vitamins")).toMatchObject({ home: "Morning Routine", rule: rule("weekdays") });
	});

	it("nests under an existing home line", () => {
		const next = addRoutine(FILE, { kind: "task", rule: rule("daily"), text: "Read", home: "Night Routine" });
		expect(find(next, "Read")).toMatchObject({ home: "Night Routine", inherited: { kind: "domain", id: "Health" } });
		expect(next.match(/Night Routine/g)).toHaveLength(1);
	});

	it("creates a home line (with its association) when the section has none", () => {
		const next = addRoutine(FILE, {
			kind: "task",
			rule: rule("weekends"),
			text: "Plan the week",
			home: "Deep Work",
			homeAssoc: { kind: "project", id: "Kairos" },
		});
		expect(next.endsWith("## Weekends\n- Deep Work [Kairos]\n\t- [ ] Plan the week\n")).toBe(true);
		expect(find(next, "Plan the week")).toMatchObject({ home: "Deep Work", inherited: { kind: "project", id: "Kairos" } });
	});

	it("doesn't nest under a block whose own 🔁 is a different rule", () => {
		const next = addRoutine(FILE, { kind: "task", rule: rule("weekdays"), text: "Shower", home: "Gym" });
		expect(find(next, "Shower")).toMatchObject({ home: "Gym", rule: rule("weekdays") });
		expect(lines(next).filter((l) => l === "- Gym")).toHaveLength(1);
	});

	it("keeps CRLF line endings", () => {
		const md = "## Daily\r\n- [ ] Read\r\n";
		expect(addRoutine(md, { kind: "task", rule: rule("daily"), text: "Walk" })).toBe(
			"## Daily\r\n- [ ] Read\r\n- [ ] Walk\r\n",
		);
	});

	it("round-trips every routine of the file through draftOf", () => {
		let md = "";
		for (const r of routines(FILE)) md = addRoutine(md, draftOf(r));
		const strip = (rs: Routine[]) =>
			rs.map(({ line: _l, ...rest }) => rest).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
		expect(strip(routines(md))).toEqual(strip(routines(FILE)));
	});
});

describe("scheduleInNewBlock", () => {
	const md = "# Mon, Wed\n- [ ] Noteworthy Rehearsal [Learning]\n\n## Weekends\n- [ ] Brunch prep\n";

	it("adds a block on the task's rule and moves the task into it", () => {
		const task = parseRoutines(md).routines.find((r) => r.kind === "task" && r.text === "Noteworthy Rehearsal");
		if (task?.kind !== "task") throw new Error("fixture");
		const next = scheduleInNewBlock(md, task, "Rehearsal", { start: 1110, end: 1230 });
		const after = parseRoutines(next).routines;
		const block = after.find((r) => r.kind === "block");
		const moved = after.find((r) => r.kind === "task" && r.text === "Noteworthy Rehearsal");
		expect(block).toMatchObject({ title: "Rehearsal", time: { start: 1110, end: 1230 }, rule: task.rule });
		expect(moved).toMatchObject({ home: "Rehearsal", assoc: { kind: "project", id: "Learning" } });
		// The other rule's routine is untouched.
		expect(next).toContain("- [ ] Brunch prep");
		expect(parseRoutines(next).problems).toEqual([]);
	});
});
