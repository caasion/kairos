import { describe, expect, it } from "vitest";
import { parseBacklog, serializeBacklog } from "./backlog";
import type { BacklogEntry } from "./types";

const P = "Backlog.md";

describe("parseBacklog", () => {
	it("parses a plain, unassociated entry", () => {
		const [e] = parseBacklog("- Buy milk", P);
		expect(e?.text).toBe("Buy milk");
		expect(e?.assoc).toBeUndefined();
		expect(e?.resurface).toBeUndefined();
		expect(e?.source).toEqual({ path: P, line: 0 });
	});

	it("parses a project association", () => {
		const [e] = parseBacklog("- Draft outline [Thesis]", P);
		expect(e?.text).toBe("Draft outline");
		expect(e?.assoc).toEqual({ kind: "project", id: "Thesis" });
	});

	it("parses a domain association", () => {
		const [e] = parseBacklog("- Stretch [D:Health]", P);
		expect(e?.assoc).toEqual({ kind: "domain", id: "Health" });
	});

	it("parses a resurface date", () => {
		const [e] = parseBacklog("- Renew passport 📅 2026-09-01", P);
		expect(e?.text).toBe("Renew passport");
		expect(e?.resurface).toBe("2026-09-01");
	});

	it("parses association + resurface together, in either order", () => {
		const [a] = parseBacklog("- Call bank [Money] 📅 2026-08-15", P);
		expect(a?.text).toBe("Call bank");
		expect(a?.assoc).toEqual({ kind: "project", id: "Money" });
		expect(a?.resurface).toBe("2026-08-15");

		const [b] = parseBacklog("- Call bank 📅 2026-08-15 [Money]", P);
		expect(b?.text).toBe("Call bank");
		expect(b?.assoc).toEqual({ kind: "project", id: "Money" });
		expect(b?.resurface).toBe("2026-08-15");
	});

	it("tolerates and discards a stray checkbox (entries aren't tasks)", () => {
		const [e] = parseBacklog("- [ ] Not really a task [Thesis]", P);
		expect(e?.text).toBe("Not really a task");
		expect(e?.assoc).toEqual({ kind: "project", id: "Thesis" });
	});

	it("skips non-list lines and records correct line numbers", () => {
		const md = ["# Backlog", "", "- First", "some prose", "- Second [D:Life]"].join(
			"\n",
		);
		const entries = parseBacklog(md, P);
		expect(entries).toHaveLength(2);
		expect(entries[0]?.text).toBe("First");
		expect(entries[0]?.source.line).toBe(2);
		expect(entries[1]?.text).toBe("Second");
		expect(entries[1]?.source.line).toBe(4);
	});

	it("yields [] for empty or list-less files", () => {
		expect(parseBacklog("", P)).toEqual([]);
		expect(parseBacklog("just prose, no list", P)).toEqual([]);
	});
});

describe("serializeBacklog", () => {
	it("emits one list item per entry with a trailing newline", () => {
		const entries: BacklogEntry[] = [
			{ source: { path: P, line: 0 }, text: "Alpha" },
			{
				source: { path: P, line: 1 },
				text: "Beta",
				assoc: { kind: "domain", id: "Life" },
			},
		];
		expect(serializeBacklog(entries)).toBe("- Alpha\n- Beta [D:Life]\n");
	});

	it("emits empty string for no entries (an empty backlog file)", () => {
		expect(serializeBacklog([])).toBe("");
	});
});

describe("parseBacklog / serializeBacklog round-trip", () => {
	const cases: { name: string; entry: BacklogEntry }[] = [
		{
			name: "plain",
			entry: { source: { path: P, line: 0 }, text: "Buy milk" },
		},
		{
			name: "project assoc",
			entry: {
				source: { path: P, line: 0 },
				text: "Draft outline",
				assoc: { kind: "project", id: "Thesis" },
			},
		},
		{
			name: "domain + resurface",
			entry: {
				source: { path: P, line: 0 },
				text: "Stretch",
				assoc: { kind: "domain", id: "Health" },
				resurface: "2026-09-01",
			},
		},
	];

	for (const { name, entry } of cases) {
		it(`round-trips: ${name}`, () => {
			const md = serializeBacklog([entry]);
			const [back] = parseBacklog(md, P);
			expect(back?.text).toBe(entry.text);
			expect(back?.assoc).toEqual(entry.assoc);
			expect(back?.resurface).toEqual(entry.resurface);
		});
	}
});
