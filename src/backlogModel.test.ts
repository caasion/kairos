import { describe, expect, it } from "vitest";
import {
	groupBacklog,
	sortEntries,
	surfaceDate,
	surfacedOn,
} from "./backlogModel";
import type { BacklogEntry } from "./types";
import type { Resolver } from "./index";

const P = "Backlog.md";
let line = 0;
const entry = (text: string, extra: Partial<BacklogEntry> = {}): BacklogEntry => ({
	source: { path: P, line: line++ },
	text,
	...extra,
});

// A resolver that echoes the id as the display name, and colors "Health" green,
// so grouping-by-canonical-name and color plumbing are both exercised.
const resolve: Resolver = (assoc) => ({
	displayName: assoc.id,
	resolved: true,
	...(assoc.id === "Health" ? { color: "green" } : {}),
});

describe("groupBacklog", () => {
	it("groups by association: projects, then domains, then Unassociated last", () => {
		line = 0;
		const groups = groupBacklog(
			[
				entry("loose"),
				entry("stretch", { assoc: { kind: "domain", id: "Health" } }),
				entry("write", { assoc: { kind: "project", id: "Thesis" } }),
			],
			resolve,
		);
		expect(groups.map((g) => g.key)).toEqual([
			"project:Thesis",
			"domain:Health",
			"none",
		]);
		expect(groups.at(-1)?.name).toBe("Unassociated");
	});

	it("always includes an Unassociated group, even when empty", () => {
		const groups = groupBacklog([], resolve);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.kind).toBe("none");
		expect(groups[0]?.entries).toEqual([]);
	});

	it("carries a domain color onto the group", () => {
		line = 0;
		const groups = groupBacklog(
			[entry("stretch", { assoc: { kind: "domain", id: "Health" } })],
			resolve,
		);
		const health = groups.find((g) => g.key === "domain:Health");
		expect(health?.color).toBe("green");
	});

	it("merges entries under one group by canonical name", () => {
		line = 0;
		const groups = groupBacklog(
			[
				entry("a", { assoc: { kind: "project", id: "Thesis" } }),
				entry("b", { assoc: { kind: "project", id: "Thesis" } }),
			],
			resolve,
		);
		const thesis = groups.find((g) => g.key === "project:Thesis");
		expect(thesis?.entries.map((e) => e.text)).toEqual(["a", "b"]);
	});
});

describe("sortEntries", () => {
	it("manual preserves file order", () => {
		const es = [entry("z"), entry("a")].reverse();
		expect(sortEntries(es, "manual").map((e) => e.source.line)).toEqual(
			[...es].map((e) => e.source.line).sort((a, b) => a - b),
		);
	});

	it("alpha sorts by text", () => {
		line = 0;
		const es = [entry("Zebra"), entry("apple")];
		expect(sortEntries(es, "alpha").map((e) => e.text)).toEqual(["apple", "Zebra"]);
	});

	it("resurface sorts by date ascending, dateless entries last", () => {
		line = 0;
		const es = [
			entry("later", { resurface: "2026-10-01" }),
			entry("none1"),
			entry("soon", { resurface: "2026-08-15" }),
		];
		expect(sortEntries(es, "resurface").map((e) => e.text)).toEqual([
			"soon",
			"later",
			"none1",
		]);
	});
});

const TODAY = "2026-08-25";

describe("surfaceDate", () => {
	it("returns null when the entry has no resurface date", () => {
		expect(surfaceDate(entry("x"), TODAY)).toBeNull();
	});

	it("surfaces a future entry on its resurface date", () => {
		expect(surfaceDate(entry("x", { resurface: "2026-08-30" }), TODAY)).toBe(
			"2026-08-30",
		);
	});

	it("collapses an overdue entry onto today", () => {
		expect(surfaceDate(entry("x", { resurface: "2026-08-20" }), TODAY)).toBe(
			TODAY,
		);
	});

	it("surfaces an entry due exactly today on today", () => {
		expect(surfaceDate(entry("x", { resurface: TODAY }), TODAY)).toBe(TODAY);
	});
});

describe("surfacedOn", () => {
	it("shows overdue + due-today entries on today, once each", () => {
		line = 0;
		const entries = [
			entry("overdue", { resurface: "2026-08-01" }),
			entry("due today", { resurface: TODAY }),
			entry("future", { resurface: "2026-09-01" }),
			entry("no date"),
		];
		const onToday = surfacedOn(entries, TODAY, TODAY);
		expect(onToday.map((e) => e.text)).toEqual(["overdue", "due today"]);

		// The future entry surfaces only on its own date, nowhere before.
		expect(surfacedOn(entries, "2026-08-26", TODAY)).toEqual([]);
		expect(surfacedOn(entries, "2026-09-01", TODAY).map((e) => e.text)).toEqual([
			"future",
		]);
	});

	it("never surfaces an entry on a day before its surfaceDate", () => {
		line = 0;
		const entries = [entry("future", { resurface: "2026-09-01" })];
		// Any day strictly between today and the resurface date shows nothing.
		expect(surfacedOn(entries, "2026-08-30", TODAY)).toEqual([]);
	});

	it("orders by resurface date then file order", () => {
		line = 0;
		const entries = [
			entry("later", { resurface: "2026-08-24" }),
			entry("earlier", { resurface: "2026-08-10" }),
		];
		// Both overdue → both collapse onto today, ordered by resurface asc.
		expect(surfacedOn(entries, TODAY, TODAY).map((e) => e.text)).toEqual([
			"earlier",
			"later",
		]);
	});
});
