import { describe, expect, it } from "vitest";
import { parseRoutines } from "./routinesFile";
import { blockGroupsOf, groupRoutines } from "./routinesModel";

const FILE = `## Weekdays
- 18:00 - 19:00 Gym
- 09:00 - 12:00 Work [D:Job]
\t- [ ] Standup
\t- [ ] Inbox zero
- Night routine
\t- [ ] Journal
- [ ] Water the plants
`;

const group = groupRoutines(parseRoutines(FILE).routines)[0]!;
const shape = () =>
	blockGroupsOf(group.routines).map((g) => [
		g.block?.title ?? g.home ?? (g.unscheduled ? "Unscheduled" : "?"),
		...g.tasks.map((t) => t.text),
	]);

describe("blockGroupsOf", () => {
	it("groups tasks under their block like the Grid: by time, homes, then Unscheduled", () => {
		expect(shape()).toEqual([
			["Work", "Standup", "Inbox zero"],
			["Gym"],
			["Night routine", "Journal"],
			["Unscheduled", "Water the plants"],
		]);
	});

	it("always ends with an Unscheduled group, even an empty one", () => {
		const only = groupRoutines(parseRoutines("## Daily\n- 07:00 - 07:30 Wake up\n").routines)[0]!;
		const groups = blockGroupsOf(only.routines);
		expect(groups.at(-1)).toMatchObject({ key: "unscheduled", unscheduled: true, tasks: [] });
	});

	it("gives each group a distinct key", () => {
		const keys = blockGroupsOf(group.routines).map((g) => g.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
