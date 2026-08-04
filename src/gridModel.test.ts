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
	it("emits top-level projects, then domains (always expanded), in order", () => {
		const s = snap([project({ name: "Alpha" })], [domain()], []);
		const rows = buildRows(s);
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
		const rows = buildRows(s);
		expect(rows.map((r) => [r.kind, r.name])).toEqual([
			["domain", "Health"],
			["project", "Alpha"],
		]);
	});

	it("adds an Unassigned row only when an unowned task exists", () => {
		const withNone = snap([], [], [task({})]);
		expect(buildRows(withNone).at(-1)?.kind).toBe("unassigned");

		const owned = snap([project()], [], [task({ owner: proj("Alpha") })]);
		expect(buildRows(owned).some((r) => r.kind === "unassigned")).toBe(false);
	});

	it("omits archived projects and domains", () => {
		const s = snap(
			[project({ name: "Old", archived: true })],
			[domain({ name: "Gone", archived: true })],
			[],
		);
		expect(buildRows(s)).toHaveLength(0);
	});
});

// ─── cell task matching ────────────────────────────────────────

describe("cellTasks", () => {
	it("routes a task to its project row", () => {
		const t = task({ owner: proj("Alpha") });
		const s = snap([project({ name: "Alpha" })], [], [t]);
		const projRow = buildRows(s)[0]!;
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
		const rows = buildRows(s);
		const domRow = rows.find((r) => r.kind === "domain")!;
		const projRow = rows.find((r) => r.kind === "project")!;
		expect(cellTasks(domRow, s.days[0]!.tasks, s)).toEqual([direct]);
		expect(cellTasks(projRow, s.days[0]!.tasks, s)).toEqual([child]);
	});

	it("matches by canonical name so an aliased tag lands in the right row", () => {
		const t = task({ owner: proj("OldAlpha") });
		const s = snap([project({ name: "Alpha", aliases: ["OldAlpha"] })], [], [t]);
		const projRow = buildRows(s)[0]!;
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
		const rows = buildRows(s);
		const byKind = Object.fromEntries(
			rows.map((r) => [r.kind, rowAssociation(r)]),
		);
		expect(byKind["project"]).toEqual({ kind: "project", id: "Alpha" });
		expect(byKind["domain"]).toEqual({ kind: "domain", id: "Health" });
		expect(byKind["unassigned"]).toBeUndefined();
	});
});
