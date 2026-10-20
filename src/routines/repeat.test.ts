import { afterEach, describe, expect, it, vi } from "vitest";
import {
	blockRepeatDraft,
	repeatDraft,
	requestRepeat,
	requestRepeatBlock,
	setRepeatHandler,
} from "./repeat";
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

describe("blockRepeatDraft", () => {
	it("makes a block routine at the block's time", () => {
		const draft = blockRepeatDraft(deep, deep.time!, rule("weekdays"));
		expect(draft).toEqual({
			kind: "block",
			rule: rule("weekdays"),
			title: "Deep Work",
			time: { start: 540, end: 660 },
			assoc: { kind: "project", id: "Kairos" },
		});
		expect(addRoutine("", draft)).toBe("## Weekdays\n- 09:00 - 11:00 Deep Work [Kairos]\n");
	});

	it("writes a block read from a legacy checkbox line without the checkbox", () => {
		const draft = blockRepeatDraft(gym, gym.time!, rule("tue, thu"));
		expect(addRoutine("", draft)).toBe("## Tue, Thu\n- 18:00 - 19:00 Gym [Fitness]\n");
	});
});

describe("repeatDraft", () => {
	it("repeats the task, not the block, on a task sharing its block's line", () => {
		// "- [ ] 18:00 - 19:00 Gym [Fitness]" reads as a block holding a task "Gym"
		// on the same line; Repeat… on that task makes a task routine.
		const legacy = gym.tasks[0]!;
		expect(legacy.source).toEqual(gym.source);
		expect(repeatDraft(legacy, gym, rule("tue, thu"))).toEqual({
			kind: "task",
			rule: rule("tue, thu"),
			text: "Gym",
			home: "Gym",
			homeAssoc: { kind: "project", id: "Fitness" },
		});
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
			[gym.tasks[0]!, gym],
			[inbox.tasks[0]!, inbox],
		] as const) {
			const md = addRoutine("", repeatDraft(task, block, rule("daily")));
			expect(applyRoutines(day, parseRoutines(md).routines, "2026-10-12", PATH).added).toBe(0);
		}
	});
});

describe("the request channel", () => {
	afterEach(() => setRepeatHandler(undefined));

	it("passes the task for a task and none for a block", () => {
		const handler = vi.fn();
		setRepeatHandler(handler);
		requestRepeat(deep.tasks[0]!, deep);
		requestRepeatBlock(gym);
		expect(handler.mock.calls).toEqual([[deep, deep.tasks[0]], [gym]]);
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
