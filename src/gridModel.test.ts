import { describe, expect, it } from "vitest";
import { resolveAssociation } from "./association";
import {
	buildRows,
	cellGroups,
	cellTasks,
	dayStatus,
	dropAssociation,
	ownerRowKey,
	rolledUpProjects,
	rowAssociation,
} from "./gridModel";
import type { GridDay, GridSnapshot } from "./index";
import type {
	Association,
	Domain,
	Project,
	ResolvedTask,
} from "./types";

// Reference "today" for row-label status derivation. The fixtures' histories are
// mostly empty (→ active default), so the exact value rarely matters, but a fixed
// date keeps the label info deterministic.
const AS_OF = "2026-08-01";

// ─── fixtures ──────────────────────────────────────────────────

function domain(over: Partial<Domain> = {}): Domain {
	return {
		id: "d-health",
		name: "Health",
		aliases: [],
		description: "",
		order: 0,
		color: "#e58334",
		history: [],
		archived: false,
		source: { path: "Domains/Health.md", line: 0 },
		...over,
	};
}

function project(over: Partial<Project> = {}): Project {
	return {
		id: "p-alpha",
		name: "Alpha",
		aliases: [],
		description: "",
		history: [],
		archived: false,
		source: { path: "Projects/Alpha.md", line: 0 },
		...over,
	};
}

let line = 0;
function task(
	over: Partial<ResolvedTask> & { owner?: Association },
): ResolvedTask {
	return {
		source: { path: "2026-08-01.md", line: line++ },
		text: "t",
		status: " ",
		date: "2026-08-01",
		block: {
			source: { path: "2026-08-01.md", line: -1 },
			title: "Unscheduled",
			tasks: [],
			scheduled: false,
		},
		scheduled: false,
		colocated: false,
		...over,
	};
}

function snap(
	projects: Project[],
	domains: Domain[],
	tasks: ResolvedTask[],
	dates: string[] = ["2026-08-01"],
): GridSnapshot {
	const projectMap = new Map(projects.map((p) => [p.name, p]));
	const domainMap = new Map(domains.map((d) => [d.name, d]));
	const byDomainProjects = new Map<string, Project[]>();
	for (const d of domains) {
		byDomainProjects.set(
			d.id,
			projects.filter((p) => p.domain === d.id),
		);
	}
	const days: GridDay[] = dates.map((date) => ({
		date,
		path: `${date}.md`,
		blocks: [],
		tasks: tasks.filter((t) => t.date === date),
	}));
	return {
		days,
		projects: projectMap,
		domains: domainMap,
		byDomainProjects,
		resolve: (a) => resolveAssociation(a, projectMap, domainMap),
	};
}

const proj = (id: string): Association => ({ kind: "project", id });
const dom = (id: string): Association => ({ kind: "domain", id });

// ─── rows ──────────────────────────────────────────────────────

describe("buildRows", () => {
	it("emits top-level projects, then domains (always expanded), in order", () => {
		const s = snap([project({ name: "Alpha" })], [domain()], []);
		const rows = buildRows(s, AS_OF);
		expect(rows.map((r) => r.kind)).toEqual(["project", "domain"]);
		expect(rows[0]!.name).toBe("Alpha");
		expect(rows[1]!.name).toBe("Health");
	});

	it("always expands a domain into its child project rows", () => {
		const s = snap(
			[project({ name: "Alpha", domain: "d-health" })],
			[domain()],
			[],
		);
		const rows = buildRows(s, AS_OF);
		expect(rows.map((r) => [r.kind, r.name])).toEqual([
			["domain", "Health"],
			["project", "Alpha"],
		]);
	});

	it("adds an Unassigned row only when an unowned task exists", () => {
		const withNone = snap([], [], [task({})]);
		expect(buildRows(withNone, AS_OF).at(-1)?.kind).toBe("unassigned");

		const owned = snap([project()], [], [task({ owner: proj("Alpha") })]);
		expect(buildRows(owned, AS_OF).some((r) => r.kind === "unassigned")).toBe(false);
	});

	it("omits projects/domains that were never active and carry no task in the window", () => {
		// Archived before the window, no tasks in it → nothing historic to show.
		const archived = [
			{ date: "2026-07-01", status: "archived" as const },
		];
		const s = snap(
			[project({ name: "Old", archived: true, history: archived })],
			[domain({ name: "Gone", archived: true, history: archived })],
			[],
			["2026-08-01"],
		);
		expect(buildRows(s, AS_OF)).toHaveLength(0);
	});

	it("keeps an archived project for days it was active earlier in the window", () => {
		// Active through Aug 2, archived from Aug 3. Window spans Aug 1–3, so the
		// project earns a row (active on Aug 1–2) even though it's archived today.
		const p = project({
			name: "Wrapped",
			archived: true,
			history: [
				{ date: "2026-07-01", status: "active" },
				{ date: "2026-08-03", status: "archived" },
			],
		});
		const s = snap([p], [], [], ["2026-08-01", "2026-08-02", "2026-08-03"]);
		expect(buildRows(s, AS_OF).map((r) => r.name)).toEqual(["Wrapped"]);
	});

	it("keeps an archived project that still carries a task in the window", () => {
		// Archived across the whole window, but a task is tagged to it → keep the
		// row so that historic instance doesn't vanish.
		const p = project({
			name: "Ghost",
			archived: true,
			history: [{ date: "2026-07-01", status: "archived" }],
		});
		const t = task({ owner: proj("Ghost"), date: "2026-08-01" });
		const s = snap([p], [], [t], ["2026-08-01"]);
		expect(buildRows(s, AS_OF).map((r) => r.name)).toEqual(["Ghost"]);
	});

	it("keeps a domain header when a child project is visible in the window", () => {
		// The domain is archived today, but a child project is active in the
		// window — the header stays so the child row isn't orphaned.
		const d = domain({
			name: "Health",
			archived: true,
			history: [{ date: "2026-07-01", status: "archived" }],
		});
		const child = project({ name: "Alpha", domain: "d-health" });
		const s = snap([child], [d], [], ["2026-08-01"]);
		expect(buildRows(s, AS_OF).map((r) => [r.kind, r.name])).toEqual([
			["domain", "Health"],
			["project", "Alpha"],
		]);
	});
});

describe("dayStatus", () => {
	it("reports the row entity's effective status per day", () => {
		const p = project({
			name: "Wrapped",
			archived: true,
			history: [
				{ date: "2026-07-01", status: "active" },
				{ date: "2026-08-03", status: "archived" },
			],
		});
		const s = snap([p], [], [], ["2026-08-02", "2026-08-03"]);
		const row = buildRows(s, AS_OF)[0]!;
		expect(dayStatus(row, "2026-08-02", s)).toBe("active");
		expect(dayStatus(row, "2026-08-03", s)).toBe("archived");
	});

	it("treats the unassigned row as always active", () => {
		const s = snap([], [], [task({})]);
		const row = buildRows(s, AS_OF).find((r) => r.kind === "unassigned")!;
		expect(dayStatus(row, "2026-08-01", s)).toBe("active");
	});
});

// ─── cell task matching ────────────────────────────────────────

describe("cellTasks", () => {
	it("routes a task to its project row", () => {
		const t = task({ owner: proj("Alpha") });
		const s = snap([project({ name: "Alpha" })], [], [t]);
		const projRow = buildRows(s, AS_OF)[0]!;
		expect(cellTasks(projRow, s.days[0]!.tasks, s)).toEqual([t]);
	});

	it("domain row holds direct tasks; child project rows hold project tasks", () => {
		const child = task({ owner: proj("Alpha") });
		const direct = task({ owner: dom("Health") });
		const s = snap(
			[project({ name: "Alpha", domain: "d-health" })],
			[domain()],
			[child, direct],
		);
		const rows = buildRows(s, AS_OF);
		const domRow = rows.find((r) => r.kind === "domain")!;
		const projRow = rows.find((r) => r.kind === "project")!;
		expect(cellTasks(domRow, s.days[0]!.tasks, s)).toEqual([direct]);
		expect(cellTasks(projRow, s.days[0]!.tasks, s)).toEqual([child]);
	});

	it("matches by canonical name so an aliased tag lands in the right row", () => {
		const t = task({ owner: proj("OldAlpha") });
		const s = snap([project({ name: "Alpha", aliases: ["OldAlpha"] })], [], [t]);
		const projRow = buildRows(s, AS_OF)[0]!;
		expect(cellTasks(projRow, s.days[0]!.tasks, s)).toEqual([t]);
	});
});

describe("rowAssociation", () => {
	it("gives the create-in-cell association per row kind", () => {
		const s = snap(
			[project({ name: "Alpha", domain: "d-health" })],
			[domain()],
			[task({})],
		);
		const rows = buildRows(s, AS_OF);
		const byKind = Object.fromEntries(
			rows.map((r) => [r.kind, rowAssociation(r)]),
		);
		expect(byKind["project"]).toEqual({ kind: "project", id: "Alpha" });
		expect(byKind["domain"]).toEqual({ kind: "domain", id: "Health" });
		expect(byKind["unassigned"]).toBeUndefined();
	});
});

// ─── rollup (#11) ──────────────────────────────────────────────

describe("rollup: a project rendered on its domain's row", () => {
	// Life holds three projects: two rolled up (Laundry, Groceries) and one that
	// keeps its own row (Move house). Inactive history keeps visibility explicit.
	const life = domain({ id: "d-life", name: "Life", order: 1 });
	const groceries = project({ id: "p-g", name: "Groceries", domain: "d-life", rollup: true });
	const laundry = project({ id: "p-l", name: "Laundry", domain: "d-life", rollup: true });
	const moving = project({ id: "p-m", name: "Move house", domain: "d-life" });

	it("rolled-up projects contribute no row; the others keep theirs", () => {
		const s = snap([groceries, laundry, moving], [life], []);
		expect(buildRows(s, AS_OF).map((r) => [r.kind, r.name])).toEqual([
			["domain", "Life"],
			["project", "Move house"],
		]);
	});

	it("routes rolled-up tasks to the domain row, and the rest to their own rows", () => {
		const g = task({ owner: proj("Groceries") });
		const m = task({ owner: proj("Move house") });
		const s = snap([groceries, laundry, moving], [life], [g, m]);
		const rows = buildRows(s, AS_OF);
		const lifeRow = rows.find((r) => r.kind === "domain")!;
		const moveRow = rows.find((r) => r.name === "Move house")!;
		expect(cellTasks(lifeRow, s.days[0]!.tasks, s)).toEqual([g]);
		expect(cellTasks(moveRow, s.days[0]!.tasks, s)).toEqual([m]);
		expect(ownerRowKey(proj("Groceries"), s)).toBe("domain:Life");
		expect(ownerRowKey(proj("Move house"), s)).toBe("project:Move house");
	});

	it("a rolled-up project with no domain ignores the flag and keeps its row", () => {
		const solo = project({ name: "Solo", rollup: true });
		const t = task({ owner: proj("Solo") });
		const s = snap([solo], [life], [t]);
		const rows = buildRows(s, AS_OF);
		const soloRow = rows.find((r) => r.name === "Solo")!;
		expect(soloRow.kind).toBe("project");
		expect(cellTasks(soloRow, s.days[0]!.tasks, s)).toEqual([t]);
	});

	it("shows a domain whose only activity in the window is a rolled-up project's task", () => {
		// Life and Groceries were both inactive across the window; only a task
		// tagged to Groceries keeps Life on screen.
		const quiet = [{ date: "2026-07-01", status: "inactive" as const }];
		const d = domain({ id: "d-life", name: "Life", history: quiet });
		const p = project({ name: "Groceries", domain: "d-life", rollup: true, history: quiet });
		const t = task({ owner: proj("Groceries") });

		const without = snap([p], [d], []);
		expect(buildRows(without, AS_OF)).toHaveLength(0);

		const s = snap([p], [d], [t]);
		const rows = buildRows(s, AS_OF);
		expect(rows.map((r) => [r.kind, r.name])).toEqual([["domain", "Life"]]);
		expect(cellTasks(rows[0]!, s.days[0]!.tasks, s)).toEqual([t]);
	});

	it("shows a domain whose rolled-up project is active in the window", () => {
		const quiet = [{ date: "2026-07-01", status: "inactive" as const }];
		const d = domain({ id: "d-life", name: "Life", history: quiet });
		const p = project({ name: "Groceries", domain: "d-life", rollup: true });
		expect(buildRows(snap([p], [d], []), AS_OF).map((r) => r.name)).toEqual(["Life"]);
	});

	it("puts the domain's own tasks first, then one group per project, by name", () => {
		const own1 = task({ owner: dom("Life") });
		const l1 = task({ owner: proj("Laundry") });
		const g1 = task({ owner: proj("Groceries") });
		const own2 = task({ owner: dom("Life") });
		const g2 = task({ owner: proj("Groceries") });
		const m = task({ owner: proj("Move house") });
		const s = snap([groceries, laundry, moving], [life], [own1, l1, g1, own2, g2, m]);
		const lifeRow = buildRows(s, AS_OF).find((r) => r.kind === "domain")!;

		const { own, groups } = cellGroups(lifeRow, s.days[0]!.tasks, s);
		expect(own).toEqual([own1, own2]);
		expect(groups).toEqual([
			{ name: "Groceries", tasks: [g1, g2] },
			{ name: "Laundry", tasks: [l1] },
		]);
		// The flat list keeps the same display order.
		expect(cellTasks(lifeRow, s.days[0]!.tasks, s)).toEqual([own1, own2, g1, g2, l1]);
	});

	it("still gives a single group its header (a group, not the domain's own tasks)", () => {
		const g = task({ owner: proj("Groceries") });
		const s = snap([groceries, moving], [life], [g]);
		const lifeRow = buildRows(s, AS_OF).find((r) => r.kind === "domain")!;
		expect(cellGroups(lifeRow, s.days[0]!.tasks, s)).toEqual({
			own: [],
			groups: [{ name: "Groceries", tasks: [g] }],
		});
	});

	it("groups an alias-tagged task under the project's canonical name", () => {
		const p = project({ name: "Groceries", aliases: ["Shopping"], domain: "d-life", rollup: true });
		const t = task({ owner: proj("Shopping") });
		const s = snap([p], [life], [t]);
		const lifeRow = buildRows(s, AS_OF)[0]!;
		expect(cellGroups(lifeRow, s.days[0]!.tasks, s).groups).toEqual([
			{ name: "Groceries", tasks: [t] },
		]);
	});

	it("non-domain rows never have groups", () => {
		const t = task({ owner: proj("Move house") });
		const s = snap([moving], [life], [t]);
		const row = buildRows(s, AS_OF).find((r) => r.name === "Move house")!;
		expect(cellGroups(row, s.days[0]!.tasks, s)).toEqual({ own: [t], groups: [] });
	});

	it("dims a domain row's cells by the domain's own status", () => {
		const d = domain({
			id: "d-life",
			name: "Life",
			history: [
				{ date: "2026-07-01", status: "active" },
				{ date: "2026-08-02", status: "inactive" },
			],
		});
		const s = snap([groceries], [d], [], ["2026-08-01", "2026-08-02"]);
		const row = buildRows(s, AS_OF)[0]!;
		expect(dayStatus(row, "2026-08-01", s)).toBe("active");
		expect(dayStatus(row, "2026-08-02", s)).toBe("inactive");
	});

	it("lists a domain's rolled-up projects by name", () => {
		const s = snap([moving, laundry, groceries], [life], []);
		expect(rolledUpProjects(life, s).map((p) => p.name)).toEqual(["Groceries", "Laundry"]);
	});
});

describe("dropAssociation", () => {
	const life = domain({ id: "d-life", name: "Life" });
	const groceries = project({ name: "Groceries", domain: "d-life", rollup: true });
	const moving = project({ name: "Move house", domain: "d-life" });
	const s = snap([groceries, moving], [life], [task({})]);
	const rows = buildRows(s, AS_OF);
	const lifeRow = rows.find((r) => r.kind === "domain")!;
	const moveRow = rows.find((r) => r.name === "Move house")!;
	const unassigned = rows.find((r) => r.kind === "unassigned")!;

	it("keeps a rolled-up task's project when it stays on its domain row", () => {
		expect(dropAssociation(lifeRow, proj("Groceries"), s)).toEqual({
			assoc: proj("Groceries"),
			sameRow: true,
		});
	});

	it("assigns the domain when a task from another row lands on a rolled-up domain row", () => {
		expect(dropAssociation(lifeRow, proj("Move house"), s)).toEqual({
			assoc: dom("Life"),
			sameRow: false,
		});
	});

	it("re-files a rolled-up task dragged out to another row", () => {
		expect(dropAssociation(moveRow, proj("Groceries"), s)).toEqual({
			assoc: proj("Move house"),
			sameRow: false,
		});
		expect(dropAssociation(unassigned, proj("Groceries"), s)).toEqual({
			assoc: null,
			sameRow: false,
		});
	});

	it("is undefined with no target row", () => {
		expect(dropAssociation(undefined, proj("Groceries"), s)).toBeUndefined();
	});
});

describe("dayStatus: a domain bounds its projects", () => {
	it("an active project row is inactive on the days its domain is inactive", () => {
		const d = domain({
			history: [
				{ date: "2026-07-01", status: "active" },
				{ date: "2026-08-02", status: "inactive" },
			],
		});
		const p = project({ name: "Alpha", domain: "d-health" });
		const s = snap([p], [d], [], ["2026-08-01", "2026-08-02"]);
		const row = buildRows(s, AS_OF).find((r) => r.name === "Alpha")!;
		expect(dayStatus(row, "2026-08-01", s)).toBe("active");
		expect(dayStatus(row, "2026-08-02", s)).toBe("inactive");
	});

	it("leaves a domain-less project on its own status", () => {
		const d = domain({ history: [{ date: "2026-07-01", status: "inactive" }] });
		const p = project({ name: "Solo" });
		const s = snap([p], [d], []);
		const row = buildRows(s, AS_OF).find((r) => r.name === "Solo")!;
		expect(dayStatus(row, "2026-08-01", s)).toBe("active");
	});
});

describe("domain row label names its rolled-up projects", () => {
	it("lists live rolled-up projects by name, leaving out archived ones", () => {
		const life = domain({ id: "d-life", name: "Life" });
		const s = snap(
			[
				project({ name: "Laundry", domain: "d-life", rollup: true }),
				project({ name: "Groceries", domain: "d-life", rollup: true }),
				project({ name: "Old", domain: "d-life", rollup: true, archived: true }),
				project({ name: "Move house", domain: "d-life" }),
			],
			[life],
			[],
		);
		const row = buildRows(s, AS_OF).find((r) => r.kind === "domain")!;
		expect(row.kind === "domain" && row.info.rolledUp).toEqual(["Groceries", "Laundry"]);
	});

	it("omits the list when nothing is rolled up", () => {
		const s = snap([project({ name: "Alpha", domain: "d-health" })], [domain()], []);
		const row = buildRows(s, AS_OF).find((r) => r.kind === "domain")!;
		expect(row.kind === "domain" && row.info.rolledUp).toBeUndefined();
	});
});
