import { describe, expect, it } from "vitest";
import {
	extractFrontmatter,
	isDomainFile,
	isProjectFile,
	parseDomain,
	parseProject,
	parseStatus,
	serializeDomainFrontmatter,
	serializeProjectFrontmatter,
} from "./projectFile";

const PROJECT = `---
tags:
  - kairos/project
id: 00ca174c-92f9-4173-b3ef-936be5d6fccb
aliases:
  - alias 1
  - alias 2
domain_id: track-8a062c99
status:
  2026-07-23: active
  2026-07-18: inactive
---

# Alpha

Project notes here.
`;

const DOMAIN = `---
tags:
  - kairos/domain
id: track-8a062c99-9ee0-4682-8d05-91e2cbe518a5
aliases:
  - alias 1
order: 0
color: "#e58334"
status:
  2026-07-23: active
  2026-07-18: inactive
---
`;

describe("frontmatter detection", () => {
	it("extracts the frontmatter block", () => {
		expect(extractFrontmatter(PROJECT)).toContain("kairos/project");
		expect(extractFrontmatter("no frontmatter")).toBeNull();
	});

	it("distinguishes project from domain files", () => {
		expect(isProjectFile(PROJECT)).toBe(true);
		expect(isDomainFile(PROJECT)).toBe(false);
		expect(isDomainFile(DOMAIN)).toBe(true);
		expect(isProjectFile(DOMAIN)).toBe(false);
	});

	it("rejects a plain note", () => {
		expect(isProjectFile("# Just a note\n\nbody")).toBe(false);
		expect(isDomainFile("# Just a note")).toBe(false);
	});
});

describe("parseProject", () => {
	it("parses a project file", () => {
		const p = parseProject(PROJECT, "Projects/Alpha.md");
		expect(p).not.toBeNull();
		expect(p?.name).toBe("Alpha"); // from filename
		expect(p?.id).toBe("00ca174c-92f9-4173-b3ef-936be5d6fccb");
		expect(p?.aliases).toEqual(["alias 1", "alias 2"]);
		expect(p?.domain).toBe("track-8a062c99");
	});

	it("sorts status history oldest → newest and derives archived", () => {
		const p = parseProject(PROJECT, "Projects/Alpha.md");
		expect(p?.history.map((r) => r.date)).toEqual(["2026-07-18", "2026-07-23"]);
		expect(p?.history.at(-1)?.status).toBe("active");
		expect(p?.archived).toBe(false);
	});

	it("derives archived from the latest record", () => {
		const archived = PROJECT.replace("2026-07-23: active", "2026-07-23: archived");
		expect(parseProject(archived, "Projects/Alpha.md")?.archived).toBe(true);
	});

	it("returns null for a non-project file", () => {
		expect(parseProject(DOMAIN, "Domains/X.md")).toBeNull();
	});
});

describe("parseDomain", () => {
	it("parses a domain file", () => {
		const d = parseDomain(DOMAIN, "Domains/Health.md");
		expect(d?.name).toBe("Health");
		expect(d?.order).toBe(0);
		expect(d?.color).toBe("#e58334");
		expect(d?.aliases).toEqual(["alias 1"]);
	});
});

describe("parseStatus", () => {
	it("drops malformed dates and unknown states", () => {
		const records = parseStatus({
			"2026-07-23": "active",
			"not-a-date": "active",
			"2026-07-18": "bogus-state",
		});
		expect(records).toEqual([{ date: "2026-07-23", status: "active" }]);
	});

	it("handles a missing status gracefully", () => {
		expect(parseStatus(undefined)).toEqual([]);
	});
});

describe("caveat: tab-indented status is invalid YAML", () => {
	it("a tab-indented status map fails to parse (documents the constraint)", () => {
		// The user's original example used tabs under `status:`. YAML forbids
		// tab indentation; such a file will not parse as a Kairos project.
		const tabbed =
			"---\ntags:\n  - kairos/project\nstatus:\n\t2026-07-23: active\n---\n";
		expect(isProjectFile(tabbed)).toBe(false);
	});
});

describe("serialization round-trip", () => {
	it("project frontmatter round-trips through parse", () => {
		const original = parseProject(PROJECT, "Projects/Alpha.md")!;
		const fm = serializeProjectFrontmatter(original);
		const reparsed = parseProject(fm, "Projects/Alpha.md")!;
		expect(reparsed.id).toBe(original.id);
		expect(reparsed.aliases).toEqual(original.aliases);
		expect(reparsed.domain).toBe(original.domain);
		expect(reparsed.history).toEqual(original.history);
	});

	it("domain frontmatter round-trips through parse", () => {
		const original = parseDomain(DOMAIN, "Domains/Health.md")!;
		const fm = serializeDomainFrontmatter(original);
		const reparsed = parseDomain(fm, "Domains/Health.md")!;
		expect(reparsed.color).toBe(original.color);
		expect(reparsed.order).toBe(original.order);
		expect(reparsed.history).toEqual(original.history);
	});
});
