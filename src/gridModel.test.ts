import { describe, expect, it } from "vitest";
import { resolveAssociation } from "./association";
import { buildRows, cellTasks, dayStatus, rowAssociation } from "./gridModel";
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
		expect(buildRows(s)).toHaveLength(0);
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
		expect(buildRows(s).map((r) => r.name)).toEqual(["Wrapped"]);
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
		expect(buildRows(s).map((r) => r.name)).toEqual(["Ghost"]);
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
		expect(buildRows(s).map((r) => [r.kind, r.name])).toEqual([
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
		const row = buildRows(s)[0]!;
		expect(dayStatus(row, "2026-08-02", s)).toBe("active");
		expect(dayStatus(row, "2026-08-03", s)).toBe("archived");
	});

	it("treats the unassigned row as always active", () => {
		const s = snap([], [], [task({})]);
		const row = buildRows(s).find((r) => r.kind === "unassigned")!;
		expect(dayStatus(row, "2026-08-01", s)).toBe("active");
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
