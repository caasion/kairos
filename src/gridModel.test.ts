import { describe, expect, it } from "vitest";
import { resolveAssociation } from "./association";
import { buildRows, cellTasks, rowAssociation } from "./gridModel";
import type { GridDay, GridSnapshot } from "./index";
import type {
	Association,
	Domain,
	Project,
	ResolvedTask,
} from "./types";

// ─── fixtures ──────────────────────────────────────────────────

function domain(over: Partial<Domain> = {}): Domain {
	return {
		id: "d-health",
		name: "Health",
		aliases: [],
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
		// The real block is irrelevant to grouping; a minimal stand-in suffices.
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
	const day: GridDay = {
		date: "2026-08-01",
		path: "2026-08-01.md",
		blocks: [],
		tasks,
	};
	return {
		days: [day],
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
	it("emits top-level projects, then domains, in order", () => {
		const s = snap([project({ name: "Alpha" })], [domain()], []);
		const rows = buildRows(s, new Set());
		expect(rows.map((r) => r.kind)).toEqual(["project", "domain"]);
		expect(rows[0]!.name).toBe("Alpha");
		expect(rows[1]!.name).toBe("Health");
	});

	it("hides a project that belongs to a domain when collapsed", () => {
		const s = snap(
			[project({ name: "Alpha", domain: "d-health" })],
			[domain()],
			[],
		);
		const rows = buildRows(s, new Set());
		// Only the domain row — the child project rolls up into it.
		expect(rows.map((r) => r.name)).toEqual(["Health"]);
	});

	it("splits a domain into child project rows + a direct row when expanded", () => {
		const s = snap(
			[project({ name: "Alpha", domain: "d-health" })],
			[domain()],
			[],
		);
		const rows = buildRows(s, new Set(["d-health"]));
		expect(rows.map((r) => [r.kind, r.name])).toEqual([
			["domain", "Health"],
			["project", "Alpha"],
			["domain-direct", "Health (direct)"],
		]);
	});

	it("adds an Unassigned row only when an unowned task exists", () => {
		const withNone = snap([], [], [task({})]);
		expect(buildRows(withNone, new Set()).at(-1)?.kind).toBe("unassigned");

		const owned = snap([project()], [], [task({ owner: proj("Alpha") })]);
		expect(buildRows(owned, new Set()).some((r) => r.kind === "unassigned")).toBe(
			false,
		);
	});

	it("omits archived projects and domains", () => {
		const s = snap(
			[project({ name: "Old", archived: true })],
			[domain({ name: "Gone", archived: true })],
			[],
		);
		expect(buildRows(s, new Set())).toHaveLength(0);
	});
});

// ─── cell task matching ────────────────────────────────────────

describe("cellTasks", () => {
	it("routes a task to its project row", () => {
		const t = task({ owner: proj("Alpha") });
		const s = snap([project({ name: "Alpha" })], [], [t]);
		const projRow = buildRows(s, new Set())[0]!;
		expect(cellTasks(projRow, s.days[0]!.tasks, s)).toEqual([t]);
	});

	it("a collapsed domain absorbs its children's and its own direct tasks", () => {
		const child = task({ owner: proj("Alpha") });
		const direct = task({ owner: dom("Health") });
		const s = snap(
			[project({ name: "Alpha", domain: "d-health" })],
			[domain()],
			[child, direct],
		);
		const domRow = buildRows(s, new Set()).find((r) => r.kind === "domain")!;
		expect(cellTasks(domRow, s.days[0]!.tasks, s)).toEqual([child, direct]);
	});

	it("an expanded domain row shows nothing; children carry the tasks", () => {
		const child = task({ owner: proj("Alpha") });
		const direct = task({ owner: dom("Health") });
		const s = snap(
			[project({ name: "Alpha", domain: "d-health" })],
			[domain()],
			[child, direct],
		);
		const rows = buildRows(s, new Set(["d-health"]));
		const domRow = rows.find((r) => r.kind === "domain")!;
		const projRow = rows.find((r) => r.kind === "project")!;
		const directRow = rows.find((r) => r.kind === "domain-direct")!;
		expect(cellTasks(domRow, s.days[0]!.tasks, s)).toEqual([]);
		expect(cellTasks(projRow, s.days[0]!.tasks, s)).toEqual([child]);
		expect(cellTasks(directRow, s.days[0]!.tasks, s)).toEqual([direct]);
	});

	it("matches by canonical name so an aliased tag lands in the right row", () => {
		const t = task({ owner: proj("OldAlpha") });
		const s = snap([project({ name: "Alpha", aliases: ["OldAlpha"] })], [], [t]);
		const projRow = buildRows(s, new Set())[0]!;
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
		const rows = buildRows(s, new Set(["d-health"]));
		const byKind = Object.fromEntries(
			rows.map((r) => [r.kind, rowAssociation(r)]),
		);
		expect(byKind["project"]).toEqual({ kind: "project", id: "Alpha" });
		expect(byKind["domain"]).toEqual({ kind: "domain", id: "Health" });
		expect(byKind["domain-direct"]).toEqual({ kind: "domain", id: "Health" });
		expect(byKind["unassigned"]).toBeUndefined();
	});
});
