import { describe, expect, it } from "vitest";
import type { Domain, Project, StatusRecord } from "../types";
import { routinesHash } from "./apply";
import { activeRoutines, ownerActive } from "./owners";
import { manualMessage, planDayPrep } from "./plan";
import { missingRoutines } from "./preview";
import { parseRoutines } from "./routinesFile";

// 2026-10-05 Mon · 10-07 Wed · 10-12 Mon · 10-14 Wed.
const MON = "2026-10-05";
const WED = "2026-10-07";
const NEXT_MON = "2026-10-12";
const NEXT_WED = "2026-10-14";

function domain(name: string, history: StatusRecord[] = [], over: Partial<Domain> = {}): Domain {
	return {
		id: `d-${name}`,
		name,
		aliases: [],
		description: "",
		order: 0,
		color: "",
		history,
		archived: false,
		source: { path: `Domains/${name}.md`, line: 0 },
		...over,
	};
}

function project(name: string, history: StatusRecord[] = [], over: Partial<Project> = {}): Project {
	return {
		id: `p-${name}`,
		name,
		aliases: [],
		description: "",
		history,
		archived: false,
		source: { path: `Projects/${name}.md`, line: 0 },
		...over,
	};
}

const byName = <T extends { name: string }>(items: T[]) => new Map(items.map((i) => [i.name, i]));

// The a cappella season ends on Wednesday 10-07: rehearsals stop from then on.
const seasonEnds: StatusRecord[] = [
	{ date: "2026-09-01", status: "active" },
	{ date: WED, status: "inactive" },
];

const FILE = `# Mon, Wed
- 18:00 - 20:00 Rehearsal [Noteworthy]
\t- [ ] Warm up
- 12:00 - 13:00 Lunch
- [ ] Practise scales [D:Music]
`;
const { routines } = parseRoutines(FILE);
const titles = (rs: typeof routines) => rs.map((r) => (r.kind === "block" ? r.title : r.text));

describe("ownerActive", () => {
	const music = domain("Music");
	const projects = byName([project("Noteworthy", seasonEnds, { domain: music.id, aliases: ["NW"] })]);
	const domains = byName([music]);
	const active = ownerActive(projects, domains);

	it("follows the project's status history", () => {
		expect(active({ kind: "project", id: "Noteworthy" }, MON)).toBe(true);
		expect(active({ kind: "project", id: "Noteworthy" }, WED)).toBe(false);
	});

	it("resolves aliases", () => {
		expect(active({ kind: "project", id: "NW" }, WED)).toBe(false);
	});

	it("bounds a project by its domain", () => {
		const quiet = domain("Music", [{ date: "2026-10-01", status: "inactive" }]);
		const p = byName([project("Choir", [], { domain: quiet.id })]);
		expect(ownerActive(p, byName([quiet]))({ kind: "project", id: "Choir" }, MON)).toBe(false);
	});

	it("follows a domain's own history", () => {
		const off = byName([domain("Music", [{ date: MON, status: "archived" }])]);
		expect(ownerActive(new Map(), off)({ kind: "domain", id: "Music" }, MON)).toBe(false);
	});

	it("keeps a tag that names nothing active, so a typo doesn't hide a routine", () => {
		expect(active({ kind: "project", id: "Nowhere" }, WED)).toBe(true);
		expect(active({ kind: "domain", id: "Nowhere" }, WED)).toBe(true);
	});
});

describe("routines pause with their owner", () => {
	const music = domain("Music");
	const active = ownerActive(byName([project("Noteworthy", seasonEnds)]), byName([music]));

	it("offers a project's routines only while the project is active", () => {
		expect(titles(activeRoutines(routines, MON, active))).toEqual([
			"Rehearsal",
			"Warm up",
			"Lunch",
			"Practise scales",
		]);
		// From Wednesday the season is over: the rehearsal block and its task pause.
		expect(titles(activeRoutines(routines, WED, active))).toEqual(["Lunch", "Practise scales"]);
	});

	it("keeps every routine without an owner check", () => {
		expect(activeRoutines(routines, WED)).toBe(routines);
	});

	it("leaves paused routines out of what a day is missing", () => {
		expect(titles(missingRoutines([], activeRoutines(routines, WED, active), WED))).toEqual([
			"Lunch",
			"Practise scales",
		]);
	});

	it("applies only the active ones, and says how many are paused", () => {
		const plan = planDayPrep({
			mode: "manual",
			date: WED,
			today: MON,
			path: "day.md",
			blocks: [],
			carried: false,
			routines,
			active,
			autoApply: false,
		});
		expect(plan.outcome).toBe("added");
		expect(plan.blocks.map((b) => b.title)).not.toContain("Rehearsal");
		expect(plan.paused).toBe(2);
		expect(manualMessage(plan, WED, { routines, problems: [] }, "Routines.md")).toContain(
			"2 routines are paused",
		);
		// The hash covers what was offered, so it matches the active set.
		expect(plan.frontmatter["kairos-routines"]).toBe(
			routinesHash(activeRoutines(routines, WED, active), WED),
		);
	});

	it("offers the rehearsal again on a set-up day once the project is reactivated", () => {
		// Next Wednesday is set up mid-break; then the season restarts.
		const onBreak = activeRoutines(routines, NEXT_WED, active);
		const recorded = routinesHash(onBreak, NEXT_WED);
		const restarted = ownerActive(
			byName([project("Noteworthy", [...seasonEnds, { date: NEXT_MON, status: "active" }])]),
			byName([music]),
		);
		const back = activeRoutines(routines, NEXT_WED, restarted);
		expect(routinesHash(back, NEXT_WED)).not.toBe(recorded);
		expect(titles(missingRoutines([], back, NEXT_WED))).toContain("Rehearsal");
	});
});
