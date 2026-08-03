import { describe, expect, it } from "vitest";
import {
	appendStatus,
	extractFrontmatter,
	isDomainFile,
	isProjectFile,
	newDomain,
	newProject,
	parseDomain,
	parseProject,
	parseStatus,
	renameGuard,
	renameWithAlias,
	replaceFrontmatter,
	serializeDomainFrontmatter,
	serializeProjectFrontmatter,
	setColor,
	setDomain,
	setOrder,
} from "./projectFile";
import type { Domain, Project } from "./types";

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

// ─── pure edit functions ───────────────────────────────────────

const proj = () => parseProject(PROJECT, "Projects/Alpha.md")!;
const dom = () => parseDomain(DOMAIN, "Domains/Health.md")!;

describe("appendStatus", () => {
	it("appends a new record and re-derives archived (project)", () => {
		const p = appendStatus(proj(), "2026-08-03", "archived");
		expect(p.history.at(-1)).toEqual({ date: "2026-08-03", status: "archived" });
		expect(p.archived).toBe(true);
	});

	it("is additive — never mutates the input", () => {
		const before = proj();
		const len = before.history.length;
		appendStatus(before, "2026-08-03", "inactive");
		expect(before.history.length).toBe(len);
	});

	it("replaces a same-day record rather than stacking", () => {
		const once = appendStatus(proj(), "2026-08-03", "inactive");
		const twice = appendStatus(once, "2026-08-03", "active");
		const onThatDay = twice.history.filter((r) => r.date === "2026-08-03");
		expect(onThatDay).toEqual([{ date: "2026-08-03", status: "active" }]);
	});

	it("keeps history sorted oldest → newest", () => {
		const p = appendStatus(proj(), "2020-01-01", "inactive");
		const dates = p.history.map((r) => r.date);
		expect([...dates]).toEqual([...dates].sort());
	});

	it("refuses to archive a domain (durable), leaving it unchanged", () => {
		const d = dom();
		expect(appendStatus(d, "2026-08-03", "archived")).toBe(d);
		expect(d.archived).toBe(false);
	});

	it("still lets a domain go inactive", () => {
		const d = appendStatus(dom(), "2026-08-03", "inactive");
		expect(d.history.at(-1)?.status).toBe("inactive");
		expect(d.archived).toBe(false);
	});
});

describe("renameWithAlias", () => {
	it("moves the old name into aliases and sets the new name", () => {
		const p = renameWithAlias(proj(), "Beta");
		expect(p.name).toBe("Beta");
		expect(p.aliases).toContain("Alpha");
	});

	it("is a no-op for the same name or empty", () => {
		const p = proj();
		expect(renameWithAlias(p, "Alpha")).toBe(p);
		expect(renameWithAlias(p, "  ")).toBe(p);
	});

	it("does not duplicate an alias already present", () => {
		const p = renameWithAlias(proj(), "Beta");
		const again = renameWithAlias(p, "Gamma");
		expect(again.aliases.filter((a) => a === "Beta").length).toBe(1);
	});
});

describe("renameGuard", () => {
	const projects = new Map<string, Project>([["Alpha", proj()]]);
	const domains = new Map<string, Domain>([["Health", dom()]]);

	it("returns the clashing name on a direct name collision", () => {
		expect(renameGuard("Alpha", projects, domains)).toBe("Alpha");
		expect(renameGuard("health", projects, domains)).toBe("Health"); // case-insensitive
	});

	it("collides with an alias too (association is by name match)", () => {
		expect(renameGuard("alias 1", projects, domains)).toBe("Alpha");
	});

	it("returns null when the name is free", () => {
		expect(renameGuard("Totally New", projects, domains)).toBeNull();
	});

	it("excludes self, so renaming to your own name/alias is allowed", () => {
		const self = proj();
		expect(renameGuard("Alpha", projects, domains, self)).toBeNull();
		// "alias 2" is unique to the project; excluding self clears it. ("alias 1"
		// is deliberately shared with the domain fixture, so it would still clash —
		// which is the guard working, not a bug.)
		expect(renameGuard("alias 2", projects, domains, self)).toBeNull();
	});
});

describe("domain metadata edits", () => {
	it("setColor trims and sets", () => {
		expect(setColor(dom(), "  #fff ").color).toBe("#fff");
		expect(setColor(dom(), "").color).toBe("");
	});
	it("setOrder sets", () => {
		expect(setOrder(dom(), 7).order).toBe(7);
	});
});

describe("setDomain", () => {
	it("links a project to a domain by id", () => {
		expect(setDomain(proj(), "d-123").domain).toBe("d-123");
	});
	it("clears the link with undefined (opt-out)", () => {
		expect(setDomain(proj(), undefined).domain).toBeUndefined();
	});
});

describe("file creation", () => {
	it("newProject initializes active today, with a fresh id", () => {
		const p = newProject("Solo", "2026-08-03", "d-9");
		expect(p.name).toBe("Solo");
		expect(p.domain).toBe("d-9");
		expect(p.history).toEqual([{ date: "2026-08-03", status: "active" }]);
		expect(p.archived).toBe(false);
		expect(p.id).not.toBe("");
	});
	it("newDomain initializes active, durable, at the given order", () => {
		const d = newDomain("Craft", "2026-08-03", 2);
		expect(d.order).toBe(2);
		expect(d.history.at(-1)?.status).toBe("active");
		expect(d.archived).toBe(false);
	});
});

describe("replaceFrontmatter", () => {
	it("swaps the fence but preserves the body", () => {
		const file = "---\nold: 1\n---\n\n# Alpha\n\nbody\n";
		const next = replaceFrontmatter(file, "---\nnew: 2\n---\n");
		expect(next).toContain("new: 2");
		expect(next).not.toContain("old: 1");
		expect(next).toContain("# Alpha");
		expect(next).toContain("body");
	});
	it("prepends a fence when the file has none", () => {
		const next = replaceFrontmatter("# Just a note\n", "---\nnew: 2\n---\n");
		expect(next.startsWith("---\nnew: 2\n---\n")).toBe(true);
		expect(next).toContain("# Just a note");
	});
});
