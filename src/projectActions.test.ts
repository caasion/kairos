import { describe, expect, it } from "vitest";
import { normalizeDomainStatus, normalizeProjectStatus } from "./projectActions";
import { parseDomain, parseProject } from "./projectFile";
import type { KairosIndex } from "./index";
import type { Domain, Project } from "./types";

// The write half of decision 55: nothing in Kairos rewrites a `status:` entry it
// didn't write except an explicit accept, and an accept on a file it can make no
// sense of still writes nothing. `KairosIndex` is faked down to the two verbs
// these call — the index itself owns a vault and can't run here.

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

describe("normalizeProjectStatus (#28)", () => {
	it("writes the normalised entity on an accept", () => {
		const { index, projects } = fakeIndex();
		normalizeProjectStatus(index, parseProject(file("  2026-08-04: active\n"), "P.md")!);
		expect(projects).toHaveLength(1);
		expect(projects[0]?.anomalies).toBeUndefined();
		expect(projects[0]?.history).toEqual([{ date: "2026-08-04", status: "active" }]);
	});

	it("writes nothing at all when there is nothing it can normalise", () => {
		// The `Dismiss` case: a file whose only oddity is a state Kairos doesn't
		// know. Accepting can't be offered, and no write may happen — a write here
		// would be the silent deletion #27 is about.
		const { index, projects } = fakeIndex();
		normalizeProjectStatus(index, parseProject(file("  2026-08-04: draft\n"), "P.md")!);
		expect(projects).toEqual([]);
	});

	it("writes nothing for a file that was already canonical", () => {
		const { index, projects } = fakeIndex();
		normalizeProjectStatus(
			index,
			parseProject(file("  2026-08-04:\n    status: active\n"), "P.md")!,
		);
		expect(projects).toEqual([]);
	});
});

describe("normalizeDomainStatus (#28)", () => {
	const domainFile = (status: string) =>
		`---\ntags:\n  - kairos/domain\nid: track-1\norder: 0\nstatus:\n${status}---\n`;

	it("writes the normalised domain on an accept", () => {
		const { index, domains } = fakeIndex();
		normalizeDomainStatus(index, parseDomain(domainFile("  2026-8-4: inactive\n"), "D.md")!);
		expect(domains).toHaveLength(1);
		expect(domains[0]?.history).toEqual([{ date: "2026-08-04", status: "inactive" }]);
	});

	it("writes nothing when there is nothing it can normalise", () => {
		const { index, domains } = fakeIndex();
		normalizeDomainStatus(index, parseDomain(domainFile("  whenever: active\n"), "D.md")!);
		expect(domains).toEqual([]);
	});
});
