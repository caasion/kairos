import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
	appendStatus,
	editStatusRecord,
	isFixable,
	needsNormalizing,
	normalizeStatusMap,
	parseStatusWithAnomalies,
	effectiveRecord,
	effectiveStatus,
	normalizeHistory,
	removeStatusRecord,
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
	setDescription,
	setDomain,
	setOrder,
} from "./projectFile";
import type { Domain, Project, StatusRecord } from "./types";

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

describe("effectiveStatus", () => {
	const hist = (
		...rs: [string, "active" | "inactive" | "archived"][]
	): StatusRecord[] =>
		rs.map(([date, status]) => ({ date: date, status }));

	it("defaults to active with no records", () => {
		expect(effectiveStatus([], "2026-08-04")).toBe("active");
	});

	it("uses the most recent record on-or-before the as-of date", () => {
		const h = hist(["2026-01-01", "active"], ["2026-06-01", "inactive"]);
		expect(effectiveStatus(h, "2026-08-04")).toBe("inactive");
	});

	it("ignores records dated after the as-of date (scheduled changes)", () => {
		// Currently active; an inactive change is scheduled for Aug 7. As of Aug 4
		// it must still read active — the future record has not taken effect.
		const h = hist(["2026-01-01", "active"], ["2026-08-07", "inactive"]);
		expect(effectiveStatus(h, "2026-08-04")).toBe("active");
		expect(effectiveStatus(h, "2026-08-07")).toBe("inactive");
	});

	it("treats a record dated exactly on the as-of date as in effect", () => {
		const h = hist(["2026-08-04", "inactive"]);
		expect(effectiveStatus(h, "2026-08-04")).toBe("inactive");
	});

	it("returns active when the only records are in the future", () => {
		const h = hist(["2026-08-07", "inactive"]);
		expect(effectiveStatus(h, "2026-08-04")).toBe("active");
	});
});

describe("effectiveRecord", () => {
	const rec = (
		date: string,
		status: "active" | "inactive" | "archived",
		note?: string,
	): StatusRecord => ({ date: date, status, ...(note ? { note } : {}) });

	it("defaults to active with no bounds and no note when history is empty", () => {
		expect(effectiveRecord([], "2026-08-04")).toEqual({
			status: "active",
			note: "",
			why: "",
			since: null,
			until: null,
		});
	});

	it("surfaces the effective record's status, note, and open span", () => {
		const h = [rec("2026-01-01", "active", "baseline")];
		expect(effectiveRecord(h, "2026-08-04")).toEqual({
			status: "active",
			note: "baseline",
			why: "",
			since: "2026-01-01",
			until: null, // still open
		});
	});

	it("bounds the span with the next record's date as 'until'", () => {
		const h = [rec("2026-01-01", "active", "hard"), rec("2026-06-01", "inactive")];
		expect(effectiveRecord(h, "2026-03-01")).toEqual({
			status: "active",
			note: "hard",
			why: "",
			since: "2026-01-01",
			until: "2026-06-01",
		});
	});

	it("keeps active status for a future-dated close, surfacing it as a scheduled 'until'", () => {
		const h = [rec("2026-01-01", "active"), rec("2026-08-07", "inactive")];
		// As of Aug 4 the effective status is still active (the inactive record is
		// scheduled, not yet in effect), but the popover can surface Aug 7 as the
		// date it's scheduled to end.
		expect(effectiveRecord(h, "2026-08-04")).toEqual({
			status: "active",
			note: "",
			why: "",
			since: "2026-01-01",
			until: "2026-08-07",
		});
	});

	it("surfaces the effective record's reason", () => {
		const h: StatusRecord[] = [
			{ date: "2026-01-01", status: "active" },
			{ date: "2026-06-01", status: "inactive", why: "handed it off" },
		];
		expect(effectiveRecord(h, "2026-08-04")).toMatchObject({
			status: "inactive",
			note: "",
			why: "handed it off",
		});
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
	it("keeps malformed dates and unknown states out of the derived history", () => {
		// Out of the history, but not out of existence: a state Kairos doesn't know
		// can't drive anything, but it is reported and re-written to the file —
		// see the anomaly tests below (#27).
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

	it("parses the { status, note } object form and carries the note", () => {
		const records = parseStatus({
			"2026-07-18": { status: "active", note: "baseline" },
			"2026-07-23": { status: "active", note: "hard" },
		});
		expect(records).toEqual([
			{ date: "2026-07-18", status: "active", note: "baseline" },
			{ date: "2026-07-23", status: "active", note: "hard" },
		]);
	});

	it("parses `why` alongside `note`", () => {
		expect(
			parseStatus({
				"2026-07-18": { status: "inactive", note: "on hold", why: "burned out" },
				"2026-07-23": { status: "active", why: "picked it back up" },
			}),
		).toEqual([
			{ date: "2026-07-18", status: "inactive", note: "on hold", why: "burned out" },
			{ date: "2026-07-23", status: "active", why: "picked it back up" },
		]);
	});

	it("drops an empty/whitespace/non-string `why` rather than round-tripping ''", () => {
		expect(parseStatus({ "2026-07-18": { status: "active", why: "  " } })).toEqual([
			{ date: "2026-07-18", status: "active" },
		]);
		expect(parseStatus({ "2026-07-18": { status: "active", why: 5 } })).toEqual([
			{ date: "2026-07-18", status: "active" },
		]);
	});

	it("keeps a note verbatim regardless of status (annotation, not logic)", () => {
		const records = parseStatus({
			"2026-07-18": { status: "inactive", note: "on hold" },
		});
		expect(records[0]?.note).toBe("on hold");
	});

	it("drops an empty/whitespace/non-string note rather than round-tripping ''", () => {
		expect(parseStatus({ "2026-07-18": { status: "active", note: "  " } })).toEqual([
			{ date: "2026-07-18", status: "active" },
		]);
		expect(parseStatus({ "2026-07-18": { status: "active", note: 5 } })).toEqual([
			{ date: "2026-07-18", status: "active" },
		]);
	});

	it("still tolerates the bare-string form on read", () => {
		expect(parseStatus({ "2026-07-18": "inactive" })).toEqual([
			{ date: "2026-07-18", status: "inactive" },
		]);
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
		const original = { ...parseProject(PROJECT, "Projects/Alpha.md")!, description: "a blurb" };
		const fm = serializeProjectFrontmatter(original);
		const reparsed = parseProject(fm, "Projects/Alpha.md")!;
		expect(reparsed.id).toBe(original.id);
		expect(reparsed.aliases).toEqual(original.aliases);
		expect(reparsed.domain).toBe(original.domain);
		expect(reparsed.description).toBe("a blurb");
		expect(reparsed.history).toEqual(original.history);
	});

	it("round-trips status notes through serialize → parse", () => {
		const base = parseProject(PROJECT, "Projects/Alpha.md")!;
		const original: Project = {
			...base,
			history: [
				{ date: "2026-07-18", status: "active", note: "baseline" },
				{ date: "2026-07-23", status: "inactive" },
				{ date: "2026-07-25", status: "active", note: "hard" },
			],
		};
		const reparsed = parseProject(
			serializeProjectFrontmatter(original),
			"Projects/Alpha.md",
		)!;
		expect(reparsed.history).toEqual(original.history);
	});

	it("round-trips note and why together, and a record carrying neither", () => {
		const base = parseProject(PROJECT, "Projects/Alpha.md")!;
		const original: Project = {
			...base,
			history: [
				{
					date: "2026-07-18",
					status: "active",
					note: "getting groceries, meal planning, doing laundry",
					why: "moved out",
				},
				{ date: "2026-07-23", status: "inactive" },
				{ date: "2026-07-25", status: "archived", why: "finished" },
			],
		};
		const fm = serializeProjectFrontmatter(original);
		const reparsed = parseProject(fm, "Projects/Alpha.md")!;
		expect(reparsed.history).toEqual(original.history);
		// A record with no note/why serializes as a bare `{ status }` — no
		// synthetic empty strings in the user's file.
		expect(fm).not.toContain('why: ""');
		expect(fm).not.toContain('note: ""');
	});

	it("domain frontmatter round-trips through parse", () => {
		const original = { ...parseDomain(DOMAIN, "Domains/Health.md")!, description: "keeping fit" };
		const fm = serializeDomainFrontmatter(original);
		const reparsed = parseDomain(fm, "Domains/Health.md")!;
		expect(reparsed.color).toBe(original.color);
		expect(reparsed.order).toBe(original.order);
		expect(reparsed.description).toBe("keeping fit");
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
		// The prior record (2026-07-23) is active, so the final day-03 record must
		// differ from active to be observable (an active-after-active would be a
		// redundant transition and collapse — see the normalizeHistory tests).
		const once = appendStatus(proj(), "2026-08-03", "active");
		const twice = appendStatus(once, "2026-08-03", "inactive");
		const onThatDay = twice.history.filter((r) => r.date === "2026-08-03");
		expect(onThatDay).toEqual([{ date: "2026-08-03", status: "inactive" }]);
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

	it("carries a note and collapses a redundant consecutive transition", () => {
		// PROJECT ends active on 2026-07-23 (no note). Appending active-with-note
		// is a distinct transition (note differs) and is kept.
		const p = appendStatus(proj(), "2026-08-01", "active", "hard");
		expect(p.history.at(-1)).toEqual({ date: "2026-08-01", status: "active", note: "hard" });
		// Appending the same {active, hard} again the next day is a no-op transition.
		const q = appendStatus(p, "2026-08-05", "active", "hard");
		expect(q.history.at(-1)?.date).toBe("2026-08-01");
	});

	it("carries a why, and drops an empty one", () => {
		const p = appendStatus(proj(), "2026-08-01", "inactive", "", "  handed it off  ");
		expect(p.history.at(-1)).toEqual({
			date: "2026-08-01",
			status: "inactive",
			why: "handed it off",
		});
		const q = appendStatus(proj(), "2026-08-01", "inactive", "", "   ");
		expect(q.history.at(-1)).toEqual({ date: "2026-08-01", status: "inactive" });
	});
});

describe("normalizeHistory", () => {
	const r = (date: string, status: "active" | "inactive" | "archived", note?: string) =>
		({ date, status, ...(note ? { note } : {}) });

	it("sorts chronologically", () => {
		expect(normalizeHistory([r("2026-03-01", "active"), r("2026-01-01", "inactive")])).toEqual([
			r("2026-01-01", "inactive"),
			r("2026-03-01", "active"),
		]);
	});

	it("keeps one record per date (later input wins)", () => {
		expect(
			normalizeHistory([r("2026-01-01", "active"), r("2026-01-01", "inactive")]),
		).toEqual([r("2026-01-01", "inactive")]);
	});

	it("collapses consecutive records with identical status AND note", () => {
		expect(
			normalizeHistory([
				r("2026-01-01", "active", "hard"),
				r("2026-02-01", "active", "hard"),
			]),
		).toEqual([r("2026-01-01", "active", "hard")]);
	});

	it("does NOT collapse when the note differs (intensity change is meaningful)", () => {
		const h = normalizeHistory([
			r("2026-01-01", "active", "baseline"),
			r("2026-02-01", "active", "hard"),
		]);
		expect(h).toHaveLength(2);
	});

	it("does NOT collapse when only the why differs (two reasons, two facts)", () => {
		const h = normalizeHistory([
			{ date: "2026-01-01", status: "inactive", why: "exams" },
			{ date: "2026-02-01", status: "inactive", why: "dropped it" },
		]);
		expect(h).toHaveLength(2);
	});

	it("does NOT collapse when the status differs", () => {
		const h = normalizeHistory([r("2026-01-01", "active"), r("2026-02-01", "inactive")]);
		expect(h).toHaveLength(2);
	});
});

describe("editStatusRecord", () => {
	it("edits a prior record's status/note and re-derives archived", () => {
		const p = editStatusRecord(proj(), "2026-07-23", {
			date: "2026-07-23",
			status: "archived",
		});
		expect(p.history.find((x) => x.date === "2026-07-23")?.status).toBe("archived");
		expect(p.archived).toBe(true);
	});

	it("moves a record's date and re-sorts", () => {
		const p = editStatusRecord(proj(), "2026-07-18", {
			date: "2026-08-01",
			status: "inactive",
		});
		expect(p.history.map((x) => x.date)).toEqual(["2026-07-23", "2026-08-01"]);
	});

	it("preserves an existing why when `next` omits the key", () => {
		// The Gantt re-times a record by rebuilding it as { date, status, note } —
		// it is moving a boundary, not editing the reason, and must not wipe one.
		const withWhy = appendStatus(proj(), "2026-08-01", "inactive", "", "handed it off");
		const moved = editStatusRecord(withWhy, "2026-08-01", {
			date: "2026-08-04",
			status: "inactive",
			note: "",
		});
		expect(moved.history.at(-1)).toEqual({
			date: "2026-08-04",
			status: "inactive",
			why: "handed it off",
		});
	});

	it("replaces the why when `next` carries the key, and clears it with ''", () => {
		const withWhy = appendStatus(proj(), "2026-08-01", "inactive", "", "handed it off");
		const rewritten = editStatusRecord(withWhy, "2026-08-01", {
			date: "2026-08-01",
			status: "inactive",
			note: "",
			why: "actually, it finished",
		});
		expect(rewritten.history.at(-1)?.why).toBe("actually, it finished");
		const cleared = editStatusRecord(withWhy, "2026-08-01", {
			date: "2026-08-01",
			status: "inactive",
			note: "",
			why: "",
		});
		expect(cleared.history.at(-1)).toEqual({ date: "2026-08-01", status: "inactive" });
	});

	it("is a no-op when originalDate is not present", () => {
		const before = proj();
		expect(editStatusRecord(before, "1999-01-01", { date: "1999-01-02", status: "active" })).toBe(
			before,
		);
	});

	it("refuses to archive a domain (durable), unchanged", () => {
		const d = dom();
		expect(editStatusRecord(d, "2026-07-23", { date: "2026-07-23", status: "archived" })).toBe(d);
	});
});

describe("removeStatusRecord", () => {
	it("removes a record and re-derives archived", () => {
		const p = removeStatusRecord(proj(), "2026-07-23");
		expect(p.history.map((x) => x.date)).toEqual(["2026-07-18"]);
	});

	it("collapses a now-consecutive duplicate exposed by the removal", () => {
		const p: Project = {
			...proj(),
			history: [
				{ date: "2026-01-01", status: "active" },
				{ date: "2026-02-01", status: "inactive" },
				{ date: "2026-03-01", status: "active" },
			],
		};
		// Removing the inactive record leaves two consecutive actives → collapse.
		const after = removeStatusRecord(p, "2026-02-01");
		expect(after.history).toEqual([{ date: "2026-01-01", status: "active" }]);
	});

	it("is a no-op when the date is not present", () => {
		const before = proj();
		expect(removeStatusRecord(before, "1999-01-01")).toBe(before);
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
	it("newProject/newDomain default to an empty description, and accept one", () => {
		expect(newProject("Solo", "2026-08-03").description).toBe("");
		expect(newDomain("Craft", "2026-08-03", 0).description).toBe("");
		expect(newProject("Solo", "2026-08-03", "d-9", "blurb").description).toBe("blurb");
		expect(newDomain("Craft", "2026-08-03", 0, "blurb").description).toBe("blurb");
	});
});

describe("setDescription", () => {
	it("sets and trims the description without mutating the input", () => {
		const before = proj();
		const after = setDescription(before, "  a blurb  ");
		expect(after.description).toBe("a blurb");
		expect(before).not.toBe(after);
	});
	it('clears with ""', () => {
		expect(setDescription(dom(), "").description).toBe("");
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

// ─── non-canonical status entries (#27, #28) ───────────────────
//
// Kairos never silently rewrites frontmatter it did not write (decision 55).
// An entry in a shape or a vocabulary it wouldn't have produced stays out of the
// derived history but is reported, re-emitted verbatim on every write, and
// changed only when the user explicitly accepts the offer.

const ANOMALOUS = `---
tags:
  - kairos/project
id: bravo-9f2c
aliases: []
description: ""
domain_id: track-8a062c99
status:
  2026-07-18: active
  2026-07-23: draft
  2026-8-4: inactive
  whenever: active
---

# Bravo
`;

/**
 * A file in exactly the shape Kairos writes. Note that the `PROJECT` fixture
 * above is NOT this: it uses the flat `date: state` scalar, which is one of the
 * shapes Kairos normalises, so anything asserting "no anomalies" has to start here.
 */
const CANONICAL = `---
tags:
  - kairos/project
id: echo-4b11
aliases: []
description: ""
status:
  2026-07-18:
    status: active
    note: three sessions a week
  2026-07-23:
    status: inactive
    why: travelling
---

# Echo
`;

/** The `status:` map a serialized entity would be written back as. */
const writtenStatus = (fm: string): Record<string, unknown> =>
	(parseYaml(extractFrontmatter(fm)!) as { status: Record<string, unknown> }).status;

describe("parseStatusWithAnomalies (#27)", () => {
	it("reports nothing for a map Kairos wrote itself", () => {
		const { records, anomalies } = parseStatusWithAnomalies({
			"2026-07-18": { status: "active", note: "three sessions a week" },
			"2026-07-23": { status: "inactive", why: "travelling" },
		});
		expect(records).toHaveLength(2);
		expect(anomalies).toEqual([]);
	});

	it("keeps an unknown state out of the history and notes it as unfixable", () => {
		const { records, anomalies } = parseStatusWithAnomalies({
			"2026-07-18": { status: "active" },
			"2026-07-23": "draft",
		});
		expect(records).toEqual([{ date: "2026-07-18", status: "active" }]);
		expect(anomalies).toEqual([{ kind: "unknown-state", key: "2026-07-23", raw: "draft" }]);
		expect(isFixable(anomalies[0]!)).toBe(false);
	});

	it("treats an unknown state in the object form the same way", () => {
		const raw = { status: "draft", note: "sketching" };
		const { anomalies } = parseStatusWithAnomalies({ "2026-07-23": raw });
		expect(anomalies).toEqual([{ kind: "unknown-state", key: "2026-07-23", raw }]);
	});

	it("parses the bare-string form and marks it fixable", () => {
		const { records, anomalies } = parseStatusWithAnomalies({ "2026-08-04": "active" });
		expect(records).toEqual([{ date: "2026-08-04", status: "active" }]);
		expect(anomalies).toEqual([{ kind: "bare-string", key: "2026-08-04", raw: "active" }]);
		expect(isFixable(anomalies[0]!)).toBe(true);
	});

	it("files a near-miss date key under its padded date", () => {
		const { records, anomalies } = parseStatusWithAnomalies({ "2026-8-4": "inactive" });
		expect(records).toEqual([{ date: "2026-08-04", status: "inactive" }]);
		expect(anomalies).toEqual([{ kind: "padded-date", key: "2026-8-4", raw: "inactive" }]);
		expect(isFixable(anomalies[0]!)).toBe(true);
	});

	it("keeps a date key it can't make sense of at all out of the history", () => {
		const { records, anomalies } = parseStatusWithAnomalies({ whenever: "active" });
		expect(records).toEqual([]);
		expect(anomalies).toEqual([{ kind: "bad-date", key: "whenever", raw: "active" }]);
	});

	it("does not pad a near-miss whose padded date is already taken", () => {
		// Two entries on one date would leave Kairos picking which one survives.
		const { records, anomalies } = parseStatusWithAnomalies({
			"2026-8-4": "inactive",
			"2026-08-04": "active",
		});
		expect(records).toEqual([{ date: "2026-08-04", status: "active" }]);
		expect(anomalies.find((a) => a.key === "2026-8-4")?.kind).toBe("bad-date");
	});

	it("rejects a near-miss with an impossible month or day rather than guessing", () => {
		const { anomalies } = parseStatusWithAnomalies({ "2026-13-4": "active" });
		expect(anomalies[0]?.kind).toBe("bad-date");
	});

	it("attaches the anomalies to a parsed project, and omits the key when the file is clean", () => {
		const bravo = parseProject(ANOMALOUS, "Projects/Bravo.md")!;
		expect(bravo.history).toEqual([
			{ date: "2026-07-18", status: "active" },
			{ date: "2026-08-04", status: "inactive" },
		]);
		expect(bravo.anomalies?.map((a) => a.kind).sort()).toEqual([
			"bad-date",
			"bare-string",
			"padded-date",
			"unknown-state",
		]);
		expect(needsNormalizing(bravo)).toBe(true);
		const echo = parseProject(CANONICAL, "Projects/Echo.md")!;
		expect(echo.anomalies).toBeUndefined();
		expect(needsNormalizing(echo)).toBe(false);
	});

	it("derives archived from a padded record", () => {
		const p = parseProject(
			"---\ntags:\n  - kairos/project\nid: c\nstatus:\n  2026-1-2: archived\n---\n",
			"Projects/Charlie.md",
		)!;
		expect(p.archived).toBe(true);
	});

	it("attaches them to a domain the same way", () => {
		const d = parseDomain(
			"---\ntags:\n  - kairos/domain\nid: track-1\norder: 0\nstatus:\n  2026-07-18: draft\n---\n",
			"Domains/Health.md",
		)!;
		expect(d.anomalies).toHaveLength(1);
		expect(d.history).toEqual([]);
		expect(needsNormalizing(d)).toBe(false); // nothing fixable: no write
	});
});

describe("writing a file Kairos didn't write (#27, #28)", () => {
	it("canonicalises fixable entries and keeps unknown ones verbatim", () => {
		const bravo = parseProject(ANOMALOUS, "Projects/Bravo.md")!;
		expect(writtenStatus(serializeProjectFrontmatter(bravo))).toEqual({
			"2026-07-18": { status: "active" }, // flat scalar → object form
			"2026-07-23": "draft", // kept: Kairos can't invent a state it doesn't know
			"2026-08-04": { status: "inactive" }, // near-miss → padded
			whenever: "active", // kept: not a date it can read
		});
	});

	it("is stable after one write: the re-parsed file has nothing left to fix", () => {
		const once = parseProject(ANOMALOUS, "Projects/Bravo.md")!;
		const twice = parseProject(serializeProjectFrontmatter(once), "Projects/Bravo.md")!;
		expect(twice.history).toEqual(once.history);
		expect(needsNormalizing(twice)).toBe(false);
		expect(twice.anomalies?.map((a) => a.kind).sort()).toEqual(["bad-date", "unknown-state"]);
	});

	it("keeps an unknown state through an unrelated edit", () => {
		const bravo = parseProject(ANOMALOUS, "Projects/Bravo.md")!;
		const edited = appendStatus(bravo, "2026-09-01", "inactive", "", "wrapped up");
		const status = writtenStatus(serializeProjectFrontmatter(edited));
		expect(status["2026-07-23"]).toBe("draft");
		expect(status["2026-09-01"]).toEqual({ status: "inactive", why: "wrapped up" });
	});

	it("yields an unparsed key the moment a real record claims that date", () => {
		const bravo = parseProject(ANOMALOUS, "Projects/Bravo.md")!;
		const edited = appendStatus(bravo, "2026-07-23", "inactive");
		expect(writtenStatus(serializeProjectFrontmatter(edited))["2026-07-23"]).toEqual({
			status: "inactive",
		});
	});
});

describe("normalizeStatusMap (load-time pass)", () => {
	it("rewrites a bare-string entry into the object form", () => {
		expect(normalizeStatusMap({ "2026-08-04": "active" })).toEqual({
			"2026-08-04": { status: "active" },
		});
	});

	it("pads a near-miss date key", () => {
		expect(
			normalizeStatusMap({ "2026-8-4": { status: "inactive", why: "travel" } }),
		).toEqual({ "2026-08-04": { status: "inactive", why: "travel" } });
	});

	it("preserves unknown states and unreadable keys verbatim alongside the fix", () => {
		const raw = { status: "draft", note: "sketching" };
		expect(
			normalizeStatusMap({ "2026-08-04": "active", "2026-08-10": raw, whenever: "x" }),
		).toEqual({
			"2026-08-04": { status: "active" },
			"2026-08-10": raw,
			whenever: "x",
		});
	});

	it("returns null for a clean map, so the file is never written", () => {
		expect(
			normalizeStatusMap({
				"2026-07-18": { status: "active", note: "three sessions a week" },
			}),
		).toBeNull();
	});

	it("returns null when the only oddities are unfixable", () => {
		expect(normalizeStatusMap({ "2026-07-23": "draft", whenever: "active" })).toBeNull();
	});

	it("returns null for a missing status map", () => {
		expect(normalizeStatusMap(undefined)).toBeNull();
	});

	it("is idempotent", () => {
		const once = normalizeStatusMap({ "2026-8-4": "active", "2026-08-10": "draft" });
		expect(once).not.toBeNull();
		expect(normalizeStatusMap(once)).toBeNull();
	});
});
