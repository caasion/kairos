import { describe, expect, it } from "vitest";
import { blockLineTask, repeatDraft } from "./repeat";
import { groupRoutines } from "./routinesModel";
import { addRoutine } from "./routinesWriter";
import { parseRoutines } from "./routinesFile";
import { applyRoutines } from "./apply";
import { parseRule, type Rule } from "./rules";
import { parseSchedule } from "../parser";

const rule = (text: string): Rule => parseRule(text)!;
const PATH = "2026-10-12 Mon.md";
const day = parseSchedule(
	`## Schedule

- 09:00 - 11:00 Deep Work [Kairos]
	- [ ] Review PRs
	- [ ] Write spec [D:Admin]
- [ ] 18:00 - 19:00 Gym [Fitness]
- Unscheduled
	- [ ] Call home
`,
	PATH,
);
const deep = day[0]!;
const gym = day[1]!;
const inbox = day[2]!;

describe("repeatDraft", () => {
	it("makes a block routine from a checkable block", () => {
		const draft = repeatDraft({ source: gym.source, text: gym.title, status: " " }, gym, rule("tue, thu"));
		expect(draft).toEqual({
			kind: "block",
			rule: rule("tue, thu"),
			title: "Gym",
			time: { start: 1080, end: 1140 },
			checkable: true,
			assoc: { kind: "project", id: "Fitness" },
		});
	});

	it("makes a plain block routine from a block's own line", () => {
		const draft = repeatDraft(blockLineTask(deep), deep, rule("weekdays"));
		expect(draft).toEqual({
			kind: "block",
			rule: rule("weekdays"),
			title: "Deep Work",
			time: { start: 540, end: 660 },
			checkable: false,
			assoc: { kind: "project", id: "Kairos" },
		});
		expect(addRoutine("", draft)).toBe("## Weekdays\n- 09:00 - 11:00 Deep Work [Kairos]\n");
	});

	it("homes a nested task in its block, with the block's association on the home line", () => {
		const draft = repeatDraft(deep.tasks[0]!, deep, rule("weekdays"));
		expect(draft).toEqual({
			kind: "task",
			rule: rule("weekdays"),
			text: "Review PRs",
			home: "Deep Work",
			homeAssoc: { kind: "project", id: "Kairos" },
		});
		const md = addRoutine("", draft);
		expect(md).toBe("## Weekdays\n- Deep Work [Kairos]\n\t- [ ] Review PRs\n");
	});

	it("keeps a nested task's own association", () => {
		const draft = repeatDraft(deep.tasks[1]!, deep, rule("daily"));
		expect(draft).toMatchObject({ assoc: { kind: "domain", id: "Admin" }, home: "Deep Work" });
	});

	it("makes an Unscheduled task a task for the day's list", () => {
		const draft = repeatDraft(inbox.tasks[0]!, inbox, rule("daily"));
		expect(draft).toEqual({ kind: "task", rule: rule("daily"), text: "Call home" });
	});

	it("a repeated task is already present in the day it came from", () => {
		for (const [task, block] of [
			[deep.tasks[0]!, deep],
			[{ source: gym.source, text: gym.title, status: " " as const }, gym],
			[inbox.tasks[0]!, inbox],
		] as const) {
			const md = addRoutine("", repeatDraft(task, block, rule("daily")));
			expect(applyRoutines(day, parseRoutines(md).routines, "2026-10-12", PATH).added).toBe(0);
		}
	});
});

describe("groupRoutines", () => {
	it("groups by rule in display order, merging spellings, keeping file order", () => {
		const { routines } = parseRoutines(`## Monthly on 1
- [ ] Pay rent
## Monday and Wednesday
- [ ] Rehearsal
## Daily
- 07:00 - 07:30 Morning
	- [ ] Meds
- [ ] Sing 🔁 Mon, Wed
`);
		const groups = groupRoutines(routines);
		expect(groups.map((g) => g.name)).toEqual(["Daily", "Mon, Wed", "Monthly on 1"]);
		expect(groups[0]!.routines.map((r) => (r.kind === "block" ? r.title : r.text))).toEqual(["Morning", "Meds"]);
		expect(groups[1]!.routines.map((r) => (r.kind === "block" ? r.title : r.text))).toEqual(["Rehearsal", "Sing"]);
	});
});
