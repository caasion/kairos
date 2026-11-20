import { describe, expect, it } from "vitest";
import { demoVaultFiles, GENERATED } from "../scripts/demo-vault.mjs";
import { parseBacklog } from "./backlog";
import { parseSchedule } from "./parser";
import { parseDomain, parseProject } from "./projectFile";
import { parseRoutines } from "./routines/routinesFile";
import type { Association } from "./types";

// The demo vault (scripts/demo-vault.mjs) writes Kairos's markdown by hand.
// These tests read it back with Kairos's own parsers, so a change to the format
// that the generator doesn't follow fails here instead of leaving contributors
// with a vault that quietly shows less than it should.

const TODAY = "2026-11-04"; // a Wednesday
const files = demoVaultFiles(TODAY);
const under = (folder: string) => Object.entries(files).filter(([p]) => p.startsWith(`${folder}/`));

const projects = under("Projects").map(([p, text]) => ({ path: p, project: parseProject(text, p) }));
const domains = under("Domains").map(([p, text]) => ({ path: p, domain: parseDomain(text, p) }));
const projectNames = new Set(projects.map(({ project }) => project?.name));
const domainNames = new Set(domains.map(({ domain }) => domain?.name));

function known(assoc: Association | undefined): boolean {
	if (!assoc) return true;
	return assoc.kind === "project" ? projectNames.has(assoc.id) : domainNames.has(assoc.id);
}

describe("demo vault", () => {
	it("writes only under the paths --reset deletes", () => {
		for (const path of Object.keys(files)) {
			expect(GENERATED.some((g) => path === g || path.startsWith(`${g}/`)), path).toBe(true);
		}
	});

	it("has daily notes from two weeks back to two days ahead", () => {
		const days = under("Daily").map(([p]) => p.slice("Daily/".length, -".md".length)).sort();
		expect(days).toHaveLength(17);
		expect(days[0]).toBe("2026-10-21");
		expect(days).toContain(TODAY);
		expect(days.at(-1)).toBe("2026-11-06");
	});

	it("parses every project and domain without anomalies", () => {
		for (const { path, project } of projects) {
			expect(project, path).not.toBeNull();
			expect(project?.anomalies, path).toBeUndefined();
		}
		for (const { path, domain } of domains) {
			expect(domain, path).not.toBeNull();
			expect(domain?.anomalies, path).toBeUndefined();
		}
	});

	it("covers each project state", () => {
		const byName = new Map(projects.map(({ project }) => [project?.name, project]));
		expect(byName.get("Robotics Club")?.archived).toBe(true);
		expect(byName.get("Groceries")?.rollup).toBe(true);
		expect(byName.get("Hackathon")?.domain).toBeUndefined();
		expect(byName.get("Hackathon")?.history.at(-1)?.status).toBe("inactive");
	});

	it("gives every project a domain id that exists", () => {
		const ids = new Set(domains.map(({ domain }) => domain?.id));
		for (const { project } of projects) {
			if (project?.domain) expect(ids.has(project.domain), project.name).toBe(true);
		}
	});

	it("parses every line of every daily note as a block, task or note", () => {
		for (const [path, text] of under("Daily")) {
			const blocks = parseSchedule(text, path);
			const items = blocks.reduce((n, b) => n + 1 + b.tasks.length + (b.notes?.length ?? 0), 0);
			const listLines = text.split("\n").filter((l) => /^\s*- /.test(l)).length;
			expect(items, path).toBe(listLines);
			for (const b of blocks) {
				expect(known(b.assoc), `${path}: ${b.title}`).toBe(true);
				for (const t of b.tasks) expect(known(t.assoc), `${path}: ${t.text}`).toBe(true);
			}
		}
	});

	it("parses the routines without problems", () => {
		const { routines, problems } = parseRoutines(files["Routines.md"] ?? "");
		expect(problems).toEqual([]);
		expect(routines.length).toBeGreaterThan(0);
	});

	it("parses the backlog, with resurface dates and known associations", () => {
		const entries = parseBacklog(files["Backlog.md"] ?? "", "Backlog.md");
		expect(entries.length).toBeGreaterThan(5);
		expect(entries.some((e) => e.resurface === TODAY)).toBe(true);
		expect(entries.some((e) => !e.assoc)).toBe(true);
		for (const e of entries) expect(known(e.assoc), e.text).toBe(true);
	});
});
