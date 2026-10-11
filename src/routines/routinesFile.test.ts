import { describe, expect, it } from "vitest";
import { parseRoutines } from "./routinesFile";

const FILE = `---
tags: [kairos]
- not a routine
---

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
- [ ] Orphan line
`;

describe("parseRoutines", () => {
	const { routines, problems } = parseRoutines(FILE);

	it("skips frontmatter", () => {
		expect(routines.some((r) => r.kind === "task" && r.text === "not a routine")).toBe(false);
	});

	it("makes a block from a timed top-level line", () => {
		const morning = routines.find((r) => r.kind === "block" && r.title === "Morning Routine");
		expect(morning).toMatchObject({
			kind: "block",
			time: { start: 450, end: 480 },
			checkable: false,
			rule: { kind: "weekly", days: [1, 2, 3, 4, 5] },
		});
	});

	it("homes nested tasks in their parent's block and inherits its rule", () => {
		const meds = routines.find((r) => r.kind === "task" && r.text === "Take meds");
		expect(meds).toMatchObject({ home: "Morning Routine", rule: { days: [1, 2, 3, 4, 5] } });
	});

	it("lets a 🔁 on a line override the heading's rule", () => {
		const stretch = routines.find((r) => r.kind === "task" && r.text === "Stretch");
		expect(stretch).toMatchObject({ rule: { days: [0, 1, 2, 3, 4, 5, 6] } });
		const gym = routines.find((r) => r.kind === "block" && r.title === "Gym");
		expect(gym).toMatchObject({
			checkable: true,
			assoc: { kind: "project", id: "Fitness" },
			rule: { kind: "weekly", days: [2, 4] },
		});
	});

	it("makes an untimed checkbox line a task for Unscheduled", () => {
		const water = routines.find((r) => r.kind === "task" && r.text === "Water the plants");
		expect(water).toMatchObject({ assoc: { kind: "domain", id: "Home" } });
		expect(water && "home" in water ? water.home : undefined).toBeUndefined();
	});

	it("treats an untimed line without a checkbox as a home, not a routine", () => {
		expect(routines.some((r) => r.kind === "block" && r.title === "Night Routine")).toBe(false);
		const journal = routines.find((r) => r.kind === "task" && r.text === "Journal");
		expect(journal).toMatchObject({
			home: "Night Routine",
			inherited: { kind: "domain", id: "Health" },
		});
	});

	it("reports lines under a heading that isn't a rule", () => {
		expect(routines.some((r) => r.kind === "task" && r.text === "Orphan line")).toBe(false);
		expect(problems.map((p) => p.message)).toEqual(['"Orphan line" has no repeat rule']);
	});

	it("reports an unknown 🔁 rule", () => {
		const r = parseRoutines("- [ ] Thing 🔁 every 3 days\n");
		expect(r.routines).toEqual([]);
		expect(r.problems.map((p) => p.message)).toContain('Unknown repeat rule "every 3 days"');
	});
});
