import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

// Mock the one app dependency so the engine runs headless. Daily-note paths are
// "Daily/YYYY-MM-DD.md"; anything else returns null (not a daily note).
vi.mock("obsidian-daily-notes-interface", () => ({
	getDateFromPath: (path: string) => {
		const m = /Daily\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
		return m ? { format: () => m[1] } : null;
	},
}));

import {
	KairosIndex,
	classify,
	daySignature,
	deriveLookups,
	emptyState,
	reindexDay,
	removeDay,
	type IndexDeps,
	type IndexPaths,
} from "./index";
import { parseSchedule } from "./parser";

const PATHS: IndexPaths = {
	projectsFolder: "Projects",
	domainsFolder: "Domains",
	backlogPath: "Backlog.md",
};

const dayPath = (date: string) => `Daily/${date}.md`;

const note = (schedule: string) => `# Title\n\n## Schedule\n\n${schedule}\n`;

// ─── classify ──────────────────────────────────────────────────

describe("classify", () => {
	it("routes daily notes to a dated day", () => {
		expect(classify("Daily/2026-07-31.md", PATHS)).toEqual({
			kind: "day",
			date: "2026-07-31",
		});
	});

	it("routes the backlog file", () => {
		expect(classify("Backlog.md", PATHS).kind).toBe("backlog");
	});

	it("routes files under the projects and domains folders", () => {
		expect(classify("Projects/Alpha.md", PATHS).kind).toBe("project");
		expect(classify("Domains/Health.md", PATHS).kind).toBe("domain");
	});

	it("ignores unrelated files", () => {
		expect(classify("Random/note.md", PATHS).kind).toBe("ignore");
	});

	it("prefers day routing over folder routing", () => {
		// A daily note that happens to live nowhere special still routes as day.
		expect(classify("Daily/2026-01-01.md", PATHS).kind).toBe("day");
	});
});

// ─── daySignature ──────────────────────────────────────────────

describe("daySignature", () => {
	it("is stable across whitespace-only file differences", () => {
		const a = parseSchedule(note("- 09:00 - 10:00 Deep work"), "x");
		const b = parseSchedule(
			note("-   09:00 - 10:00   Deep work   "),
			"x",
		);
		expect(daySignature(a)).toBe(daySignature(b));
	});

	it("is unaffected by prose outside the Schedule section", () => {
		const bare = note("- 09:00 - 10:00 Deep work");
		const withProse =
			"# Title\n\nSome journaling here.\n\n## Schedule\n\n- 09:00 - 10:00 Deep work\n\n## Notes\n\nmore prose\n";
		expect(daySignature(parseSchedule(bare, "x"))).toBe(
			daySignature(parseSchedule(withProse, "x")),
		);
	});

	it("changes when the schedule changes", () => {
		const a = parseSchedule(note("- 09:00 - 10:00 Deep work"), "x");
		const b = parseSchedule(note("- 09:00 - 11:00 Deep work"), "x");
		expect(daySignature(a)).not.toBe(daySignature(b));
	});

	it("is order-sensitive", () => {
		const a = parseSchedule(
			note("- 09:00 - 10:00 A\n- 10:00 - 11:00 B"),
			"x",
		);
		const b = parseSchedule(
			note("- 10:00 - 11:00 B\n- 09:00 - 10:00 A"),
			"x",
		);
		expect(daySignature(a)).not.toBe(daySignature(b));
	});

	it("reflects task-level and association changes", () => {
		const base = parseSchedule(note("- 09:00 - 10:00 Work\n\t- [ ] todo"), "x");
		const done = parseSchedule(note("- 09:00 - 10:00 Work\n\t- [x] todo"), "x");
		const assoc = parseSchedule(
			note("- 09:00 - 10:00 Work [Alpha]\n\t- [ ] todo"),
			"x",
		);
		expect(daySignature(base)).not.toBe(daySignature(done));
		expect(daySignature(base)).not.toBe(daySignature(assoc));
	});
});

// ─── pure reindex ──────────────────────────────────────────────

describe("reindexDay / removeDay", () => {
	it("adds a day without mutating the input state", () => {
		const s0 = emptyState();
		const s1 = reindexDay(
			s0,
			dayPath("2026-07-31"),
			"2026-07-31",
			note("- 09:00 - 10:00 Work"),
			100,
		);
		expect(s0.days.size).toBe(0); // input untouched
		expect(s1.days.get("2026-07-31")?.blocks).toHaveLength(1);
		expect(s1.days.get("2026-07-31")?.mtime).toBe(100);
	});

	it("replaces just one day's entry on reparse", () => {
		let s = reindexDay(emptyState(), dayPath("d1"), "d1", note("- 09:00 - 10:00 A"), 1);
		s = reindexDay(s, dayPath("d2"), "d2", note("- 09:00 - 10:00 B"), 1);
		s = reindexDay(s, dayPath("d1"), "d1", note("- 09:00 - 10:00 A2"), 2);
		expect(s.days.get("d1")?.blocks[0]?.title).toBe("A2");
		expect(s.days.get("d2")?.blocks[0]?.title).toBe("B"); // untouched
	});

	it("removes a day", () => {
		let s = reindexDay(emptyState(), dayPath("d1"), "d1", note("- 09:00 - 10:00 A"), 1);
		s = removeDay(s, "d1");
		expect(s.days.has("d1")).toBe(false);
	});
});

// ─── deriveLookups ─────────────────────────────────────────────

describe("deriveLookups", () => {
	it("buckets resolved tasks by project and domain owner", () => {
		let s = reindexDay(
			emptyState(),
			dayPath("d1"),
			"d1",
			note(
				"- 09:00 - 10:00 Work [Alpha]\n\t- [ ] task one\n- [ ] 10:00 - 11:00 Errand [D:Life]",
			),
			1,
		);
		s = deriveLookups(s);
		// task one inherits [Alpha]; the checkable Errand block surfaces as a
		// task owning [D:Life]. A non-checkable childless block would contribute
		// no task (only time), so it would not bucket here — see resolver.
		expect(s.byProject.get("Alpha")).toBeTruthy();
		expect(s.byDomain.get("Life")).toBeTruthy();
	});

	it("rebuilds lookups fresh (no stale entries after a day changes)", () => {
		let s = reindexDay(
			emptyState(),
			dayPath("d1"),
			"d1",
			note("- 09:00 - 10:00 Work [Alpha]\n\t- [ ] t"),
			1,
		);
		expect(s.byProject.get("Alpha")).toHaveLength(1);
		// Re-parse the same day with the association removed.
		s = reindexDay(s, dayPath("d1"), "d1", note("- 09:00 - 10:00 Work\n\t- [ ] t"), 2);
		expect(s.byProject.get("Alpha")).toBeUndefined();
	});
});

// ─── live index: stores, optimistic edit, echo-dedup ───────────

describe("KairosIndex", () => {
	let writes: { path: string; content: string }[];
	let deps: IndexDeps;

	beforeEach(() => {
		vi.useFakeTimers();
		writes = [];
		deps = {
			read: async () => "",
			write: async (path, content) => {
				writes.push({ path, content });
			},
			now: () => 1000,
			settings: PATHS,
			writeDebounceMs: 500,
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("seeds days and exposes them via the day store", () => {
		const idx = new KairosIndex(deps);
		idx.seed([
			{ path: dayPath("2026-07-31"), content: note("- 09:00 - 10:00 Work"), mtime: 5 },
		]);
		const day = get(idx.day("2026-07-31"));
		expect(day?.blocks[0]?.title).toBe("Work");
	});

	it("day store is undefined for a date with no note", () => {
		const idx = new KairosIndex(deps);
		idx.seed([]);
		expect(get(idx.day("2026-01-01"))).toBeUndefined();
	});

	it("applyDayEdit notifies subscribers synchronously (optimistic)", () => {
		const idx = new KairosIndex(deps);
		idx.seed([]);
		const store = idx.day("2026-07-31");
		const seen: (string | undefined)[] = [];
		store.subscribe((d) => seen.push(d?.blocks[0]?.title));

		const blocks = parseSchedule(note("- 09:00 - 10:00 New"), dayPath("2026-07-31"));
		idx.applyDayEdit("2026-07-31", dayPath("2026-07-31"), blocks);

		// Store updated immediately, before any timer fires.
		expect(get(store)?.blocks[0]?.title).toBe("New");
		expect(seen.at(-1)).toBe("New");
		// No write yet — it's debounced.
		expect(writes).toHaveLength(0);
	});

	it("debounces the file write after applyDayEdit", () => {
		const idx = new KairosIndex(deps);
		idx.seed([]);
		const path = dayPath("2026-07-31");
		idx.applyDayEdit(
			"2026-07-31",
			path,
			parseSchedule(note("- 09:00 - 10:00 A"), path),
		);
		idx.applyDayEdit(
			"2026-07-31",
			path,
			parseSchedule(note("- 09:00 - 10:00 B"), path),
		);
		vi.advanceTimersByTime(500);
		// Coalesced into one write of the latest content.
		expect(writes).toHaveLength(1);
		expect(writes[0]?.content).toContain("B");
		expect(writes[0]?.content).not.toContain("- 09:00 - 10:00 A\n");
	});

	it("drops an echo: a modify matching the schedule notifies no one", () => {
		const idx = new KairosIndex(deps);
		const path = dayPath("2026-07-31");
		idx.seed([{ path, content: note("- 09:00 - 10:00 Work"), mtime: 1 }]);
		const store = idx.day("2026-07-31");

		let notifications = 0;
		store.subscribe(() => notifications++); // 1 initial call on subscribe
		const baseline = notifications;

		// Same schedule, different whitespace + later mtime (a write echo).
		idx.onFileChanged(path, note("-  09:00 - 10:00 Work  "), 9);
		expect(notifications).toBe(baseline); // no extra notification
	});

	it("notifies on a real external change", () => {
		const idx = new KairosIndex(deps);
		const path = dayPath("2026-07-31");
		idx.seed([{ path, content: note("- 09:00 - 10:00 Work"), mtime: 1 }]);
		const store = idx.day("2026-07-31");

		let notifications = 0;
		store.subscribe(() => notifications++);
		const baseline = notifications;

		idx.onFileChanged(path, note("- 09:00 - 11:00 Work"), 9);
		expect(notifications).toBe(baseline + 1);
		expect(get(store)?.blocks[0]?.time?.end).toBe(11 * 60);
	});

	it("ignores a stale modify older than what it holds", () => {
		const idx = new KairosIndex(deps);
		const path = dayPath("2026-07-31");
		idx.seed([{ path, content: note("- 09:00 - 10:00 Work"), mtime: 10 }]);
		const store = idx.day("2026-07-31");
		idx.onFileChanged(path, note("- 08:00 - 09:00 Stale"), 5); // older mtime
		expect(get(store)?.blocks[0]?.title).toBe("Work"); // unchanged
	});

	it("clears the day when its file is deleted", () => {
		const idx = new KairosIndex(deps);
		const path = dayPath("2026-07-31");
		idx.seed([{ path, content: note("- 09:00 - 10:00 Work"), mtime: 1 }]);
		const store = idx.day("2026-07-31");
		idx.onFileDeleted(path);
		expect(get(store)).toBeUndefined();
	});

	it("dispose cancels pending writes", () => {
		const idx = new KairosIndex(deps);
		const path = dayPath("2026-07-31");
		idx.applyDayEdit("2026-07-31", path, parseSchedule(note("- 09:00 - 10:00 A"), path));
		idx.dispose();
		vi.advanceTimersByTime(1000);
		expect(writes).toHaveLength(0);
	});
});
