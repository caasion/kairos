import { describe, expect, it } from "vitest";
import { resolveAssociation } from "./association";
import type { Association, Domain, Project } from "./types";

function domain(over: Partial<Domain> = {}): Domain {
	return {
		id: "track-health",
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

const domains = (...ds: Domain[]) => new Map(ds.map((d) => [d.name, d]));
const projects = (...ps: Project[]) => new Map(ps.map((p) => [p.name, p]));

const proj = (id: string): Association => ({ kind: "project", id });
const dom = (id: string): Association => ({ kind: "domain", id });

describe("resolveAssociation — domains", () => {
	it("resolves a domain to its name, color, and target", () => {
		const r = resolveAssociation(dom("Health"), projects(), domains(domain()));
		expect(r).toEqual({
			displayName: "Health",
			color: "#e58334",
			target: "Domains/Health.md",
			resolved: true,
		});
	});

	it("matches by alias but displays the canonical name", () => {
		const d = domain({ aliases: ["Wellness"] });
		const r = resolveAssociation(dom("Wellness"), projects(), domains(d));
		expect(r.displayName).toBe("Health"); // canonical, not the alias
		expect(r.resolved).toBe(true);
	});

	it("renders an unknown domain neutrally (no color, no target)", () => {
		const r = resolveAssociation(dom("Ghost"), projects(), domains());
		expect(r).toEqual({ displayName: "Ghost", resolved: false });
	});
});

describe("resolveAssociation — projects", () => {
	it("resolves a project to its name and target", () => {
		const r = resolveAssociation(proj("Alpha"), projects(project()), domains());
		expect(r.displayName).toBe("Alpha");
		expect(r.target).toBe("Projects/Alpha.md");
		expect(r.resolved).toBe(true);
		expect(r.color).toBeUndefined(); // no domain → no color
	});

	it("takes color from the project's domain (by domain_id)", () => {
		const d = domain(); // id: track-health, color #e58334
		const p = project({ domain: "track-health" });
		const r = resolveAssociation(proj("Alpha"), projects(p), domains(d));
		expect(r.color).toBe("#e58334");
	});

	it("matches a project by alias, displays canonical name", () => {
		const p = project({ aliases: ["OldAlpha"] });
		const r = resolveAssociation(proj("OldAlpha"), projects(p), domains());
		expect(r.displayName).toBe("Alpha");
		expect(r.resolved).toBe(true);
	});

	it("renders an unknown project neutrally", () => {
		const r = resolveAssociation(proj("Nope"), projects(), domains());
		expect(r).toEqual({ displayName: "Nope", resolved: false });
	});

	it("resolves the project even if its domain_id dangles (name only, no color)", () => {
		const p = project({ domain: "track-missing" });
		const r = resolveAssociation(proj("Alpha"), projects(p), domains(domain()));
		expect(r.resolved).toBe(true);
		expect(r.color).toBeUndefined();
	});
});
