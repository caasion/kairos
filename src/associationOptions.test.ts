import { describe, expect, it } from "vitest";
import { associationOptions, filterOptions } from "./associationOptions";
import type { Domain, Project, StatusRecord } from "./types";

const hist = (...rs: [string, "active" | "inactive" | "archived"][]): StatusRecord[] =>
	rs.map(([date, status]) => ({ date, status }));

function project(name: string, over: Partial<Project> = {}): Project {
	return {
		id: `p-${name}`,
		name,
		aliases: [],
		description: "",
		history: [],
		archived: false,
		source: { path: `Projects/${name}.md`, line: 0 },
		...over,
	};
}

function domain(name: string, over: Partial<Domain> = {}): Domain {
	return {
		id: `d-${name}`,
		name,
		aliases: [],
		description: "",
		order: 0,
		color: "#fff",
		history: [],
		archived: false,
		source: { path: `Tracks/${name}.md`, line: 0 },
		...over,
	};
}

const pmap = (...ps: Project[]) => new Map(ps.map((p) => [p.name, p]));
const dmap = (...ds: Domain[]) => new Map(ds.map((d) => [d.name, d]));

describe("associationOptions", () => {
	it("lists projects and domains as options", () => {
		const opts = associationOptions(pmap(project("Alpha")), dmap(domain("Health")));
		expect(opts.map((o) => `${o.kind}:${o.name}`)).toEqual([
			"project:Alpha",
			"domain:Health",
		]);
		expect(opts[0]?.association).toEqual({ kind: "project", id: "Alpha" });
		expect(opts[1]?.association).toEqual({ kind: "domain", id: "Health" });
	});

	it("omits archived projects and domains", () => {
		const opts = associationOptions(
			pmap(project("Alpha", { archived: true }), project("Beta")),
			dmap(domain("Health", { archived: true })),
		);
		expect(opts.map((o) => o.name)).toEqual(["Beta"]);
	});

	it("reports current status from the latest record (defaults active)", () => {
		const opts = associationOptions(
			pmap(
				project("Paused", { history: hist(["2026-01-01", "active"], ["2026-06-01", "inactive"]) }),
			),
			dmap(),
		);
		expect(opts[0]?.status).toBe("inactive");
	});

	it("sorts active before inactive, then alphabetically", () => {
		const opts = associationOptions(
			pmap(
				project("Zed"),
				project("Idle", { history: hist(["2026-01-01", "inactive"]) }),
				project("Apple"),
			),
			dmap(),
		);
		expect(opts.map((o) => o.name)).toEqual(["Apple", "Zed", "Idle"]);
	});
});

describe("filterOptions", () => {
	const opts = associationOptions(
		pmap(project("Alpha"), project("Beta")),
		dmap(domain("Health")),
	);

	it("returns everything for an empty query", () => {
		expect(filterOptions(opts, "  ")).toHaveLength(3);
	});

	it("matches a case-insensitive substring of the name", () => {
		// "al" is a substring of both "Alpha" and "HeALth".
		expect(filterOptions(opts, "al").map((o) => o.name).sort()).toEqual([
			"Alpha",
			"Health",
		]);
		expect(filterOptions(opts, "eta").map((o) => o.name)).toEqual(["Beta"]);
		expect(filterOptions(opts, "HEALTH").map((o) => o.name)).toEqual(["Health"]);
	});
});
