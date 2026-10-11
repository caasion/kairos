import { describe, expect, it } from "vitest";
import { setDomainStatus, setProjectRollup, setProjectStatus } from "./projectActions";
import {
	parseDomain,
	parseProject,
	serializeDomainFrontmatter,
	serializeProjectFrontmatter,
} from "./projectFile";
import type { KairosIndex } from "./index";
import type { Domain, Project } from "./types";

// A status change records its reason, and — since any write emits the status map
// canonically — normalises the file's fixable entries as a side effect while
// keeping the unknown ones verbatim. `KairosIndex` is faked down to the two
// verbs these call; the index itself owns a vault and can't run here.

function fakeIndex() {
	const projects: Project[] = [];
	const domains: Domain[] = [];
	const index = {
		applyProjectEdit: (p: Project) => projects.push(p),
		applyDomainEdit: (d: Domain) => domains.push(d),
	} as unknown as KairosIndex;
	return { index, projects, domains };
}

const file = (status: string) =>
	`---\ntags:\n  - kairos/project\nid: foxtrot-1\nstatus:\n${status}---\n`;

describe("setProjectStatus", () => {
	it("records the why on the new record", () => {
		const { index, projects } = fakeIndex();
		const p = parseProject(file("  2026-08-04:\n    status: active\n"), "P.md")!;
		setProjectStatus(index, p, "2026-09-01", "inactive", undefined, "handed off");
		expect(projects[0]?.history.at(-1)).toEqual({
			date: "2026-09-01",
			status: "inactive",
			why: "handed off",
		});
	});

	it("canonicalises fixable entries and keeps unknown ones on the same write", () => {
		const { index, projects } = fakeIndex();
		const p = parseProject(
			file("  2026-8-4: active\n  2026-08-10: draft\n"),
			"P.md",
		)!;
		setProjectStatus(index, p, "2026-09-01", "archived");
		const fm = serializeProjectFrontmatter(projects[0]!);
		expect(fm).toContain("2026-08-04:\n    status: active");
		expect(fm).not.toContain("2026-8-4");
		expect(fm).toContain("2026-08-10: draft");
	});
});

describe("setDomainStatus", () => {
	const domainFile = (status: string) =>
		`---\ntags:\n  - kairos/domain\nid: track-1\norder: 0\nstatus:\n${status}---\n`;

	it("writes a bare-string entry back in object form", () => {
		const { index, domains } = fakeIndex();
		const d = parseDomain(domainFile("  2026-08-04: active\n"), "D.md")!;
		setDomainStatus(index, d, "2026-09-01", "inactive", undefined, "paused");
		const fm = serializeDomainFrontmatter(domains[0]!);
		expect(fm).toContain("2026-08-04:\n    status: active");
		expect(fm).toContain("why: paused");
	});
});

describe("setProjectRollup", () => {
	const projectFile = (extra = "") =>
		`---\ntags:\n  - kairos/project\nid: groceries-1\ndomain_id: life-1\n${extra}status:\n  2026-08-04:\n    status: active\n---\n`;

	it("writes `rollup: true` through the index", () => {
		const { index, projects } = fakeIndex();
		const p = parseProject(projectFile(), "Groceries.md")!;
		setProjectRollup(index, p, true);
		expect(projects).toHaveLength(1);
		expect(projects[0]!.rollup).toBe(true);
		expect(serializeProjectFrontmatter(projects[0]!)).toContain("rollup: true");
	});

	it("turning it off removes the key rather than writing false", () => {
		const { index, projects } = fakeIndex();
		const p = parseProject(projectFile("rollup: true\n"), "Groceries.md")!;
		setProjectRollup(index, p, false);
		expect(serializeProjectFrontmatter(projects[0]!)).not.toContain("rollup");
	});

	it("is a no-op when the flag already has that value", () => {
		const { index, projects } = fakeIndex();
		setProjectRollup(index, parseProject(projectFile(), "Groceries.md")!, false);
		setProjectRollup(index, parseProject(projectFile("rollup: true\n"), "Groceries.md")!, true);
		expect(projects).toHaveLength(0);
	});
});
