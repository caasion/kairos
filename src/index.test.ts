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
	backlogSignature,
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
import { addTaskToUnscheduled } from "./writer";
import type { BacklogEntry } from "./types";

const PATHS: IndexPaths = {
	projectsFolder: "Projects",
	domainsFolder: "Domains",
	backlogPath: "Backlog.md",
	scheduleHeading: "## Schedule",
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
			rename: async () => {},
			remove: async () => {},
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

	it("debounces the file write after applyDayEdit", async () => {
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
		// The write now reads-then-splices, so it settles a microtask after the
		// debounce fires; let that async work flush before asserting.
		await vi.advanceTimersByTimeAsync(500);
		// Coalesced into one write of the latest content.
		expect(writes).toHaveLength(1);
		expect(writes[0]?.content).toContain("B");
		expect(writes[0]?.content).not.toContain("- 09:00 - 10:00 A\n");
	});

	it("splices the section on write, preserving other note content", async () => {
		// A note with frontmatter + prose + a trailing Notes section around the
		// Schedule. The write must touch only the Schedule section.
		const existing =
			"---\ntags: [daily]\n---\n\n## Schedule\n\n- 08:00 - 09:00 Old\n\n## Notes\n\nkeep me\n";
		let file = existing;
		const spliceDeps: IndexDeps = {
			read: async () => file,
			write: async (_path, content) => {
				file = content;
			},
			rename: async () => {},
			remove: async () => {},
			now: () => 1000,
			settings: PATHS,
			writeDebounceMs: 500,
		};
		const idx = new KairosIndex(spliceDeps);
		const path = dayPath("2026-07-31");
		idx.seed([{ path, content: existing, mtime: 1 }]);

		idx.applyDayEdit(
			"2026-07-31",
			path,
			parseSchedule(note("- 09:00 - 10:00 New"), path),
		);
		await vi.advanceTimersByTimeAsync(500);

		expect(file).toContain("tags: [daily]");
		expect(file).toContain("- 09:00 - 10:00 New");
		expect(file).not.toContain("Old");
		expect(file).toContain("## Notes");
		expect(file).toContain("keep me");
	});

	it("writes under the heading active at edit time, not a later change", async () => {
		// A note whose section uses the current heading.
		let file = "## Schedule\n\n- 08:00 - 09:00 Old\n";
		const mutablePaths: IndexPaths = { ...PATHS, scheduleHeading: "## Schedule" };
		const capDeps: IndexDeps = {
			read: async () => file,
			write: async (_path, content) => {
				file = content;
			},
			rename: async () => {},
			remove: async () => {},
			now: () => 1000,
			settings: mutablePaths,
			writeDebounceMs: 500,
		};
		const idx = new KairosIndex(capDeps);
		const path = dayPath("2026-07-31");
		idx.seed([{ path, content: file, mtime: 1 }]);

		// Edit under "## Schedule", then flip the heading before the write fires.
		idx.applyDayEdit(
			"2026-07-31",
			path,
			parseSchedule(note("- 09:00 - 10:00 New"), path),
		);
		mutablePaths.scheduleHeading = "# My Day";
		await vi.advanceTimersByTimeAsync(500);

		// The write replaced the existing "## Schedule" section (heading captured
		// at edit time) rather than appending a mismatched "# My Day" one.
		expect(file).toContain("## Schedule");
		expect(file).toContain("- 09:00 - 10:00 New");
		expect(file).not.toContain("# My Day");
		expect(file).not.toContain("Old");
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

	it("keeps a pending edit when the daily note's creation echoes back", async () => {
		const idx = new KairosIndex(deps);
		const date = "2026-07-31";
		const path = dayPath(date);
		idx.seed([]);
		const store = idx.day(date);

		// First edit on a day with no note: the view created the note, then applied
		// the edit. `now()` is 1000, so the echo's mtime is NOT older — only the
		// pending-write gate can save it.
		idx.applyDayEdit(date, path, parseSchedule(note("- 09:00 - 10:00 A"), path));

		// The vault's create event arrives afterwards with the bare template.
		idx.onFileChanged(path, "# Title\n", 1000);
		expect(get(store)?.blocks.map((b) => b.title)).toEqual(["A"]);

		// ...and the debounced write persists the edit, not the template.
		await vi.advanceTimersByTimeAsync(500);
		expect(writes[0]?.content).toContain("09:00 - 10:00 A");
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

// ─── live index: project / domain stores ───────────────────────

const PROJECT_FILE = `---
tags:
  - kairos/project
id: p-alpha
aliases: []
domain_id:
status:
  2026-07-01: active
---
`;

describe("KairosIndex project/domain stores", () => {
	const deps: IndexDeps = {
		read: async () => "",
		write: async () => {},
		rename: async () => {},
		remove: async () => {},
		now: () => 1000,
		settings: PATHS,
		writeDebounceMs: 500,
	};

	it("seeds a project and exposes it via the project store", () => {
		const idx = new KairosIndex(deps);
		idx.seed([{ path: "Projects/Alpha.md", content: PROJECT_FILE, mtime: 1 }]);
		const view = get(idx.project("Alpha"));
		expect(view?.project.id).toBe("p-alpha");
		expect(view?.tasks).toEqual([]);
	});

	it("is undefined for an unknown project", () => {
		const idx = new KairosIndex(deps);
		idx.seed([]);
		expect(get(idx.project("Nope"))).toBeUndefined();
	});

	it("project view gains tasks when a day edit associates one", () => {
		const idx = new KairosIndex(deps);
		idx.seed([{ path: "Projects/Alpha.md", content: PROJECT_FILE, mtime: 1 }]);
		const store = idx.project("Alpha");
		expect(get(store)?.tasks).toHaveLength(0);

		const path = dayPath("2026-07-31");
		idx.applyDayEdit(
			"2026-07-31",
			path,
			parseSchedule(note("- 09:00 - 10:00 Work [Alpha]\n\t- [ ] t"), path),
		);
		// The inherited-[Alpha] child task now shows in the project view.
		expect(get(store)?.tasks).toHaveLength(1);
	});

	it("drops a project when its file is deleted", () => {
		const idx = new KairosIndex(deps);
		idx.seed([{ path: "Projects/Alpha.md", content: PROJECT_FILE, mtime: 1 }]);
		const store = idx.project("Alpha");
		idx.onFileDeleted("Projects/Alpha.md");
		expect(get(store)).toBeUndefined();
	});
});

// ─── projects & domains page feed ──────────────────────────────

const DOMAIN_HEALTH = `---
tags:
  - kairos/domain
id: d-health
aliases: []
order: 1
color: "#55c5a3"
status:
  2026-07-01: active
---
`;
const DOMAIN_CAREER = `---
tags:
  - kairos/domain
id: d-career
aliases: []
order: 0
color: "#55a3e0"
status:
  2026-07-01: active
---
`;
// A project linked to Health (by the domain's stable id).
const PROJECT_LINKED = `---
tags:
  - kairos/project
id: p-run
aliases: []
domain_id: d-health
status:
  2026-07-01: active
---
`;

describe("KairosIndex projectsDomains feed", () => {
	const deps: IndexDeps = {
		read: async () => "",
		write: async () => {},
		rename: async () => {},
		remove: async () => {},
		now: () => 1000,
		settings: PATHS,
		writeDebounceMs: 500,
	};

	function seeded() {
		const idx = new KairosIndex(deps);
		idx.seed([
			{ path: "Domains/Health.md", content: DOMAIN_HEALTH, mtime: 1 },
			{ path: "Domains/Career.md", content: DOMAIN_CAREER, mtime: 1 },
			{ path: "Projects/Run.md", content: PROJECT_LINKED, mtime: 1 },
			{ path: "Projects/Alpha.md", content: PROJECT_FILE, mtime: 1 },
		]);
		return idx;
	}

	it("orders domains by order, nests linked projects, orphans the rest", () => {
		const feed = get(seeded().projectsDomains());
		// Career (order 0) before Health (order 1).
		expect(feed.domains.map((d) => d.name)).toEqual(["Career", "Health"]);
		// Run links to Health by id; Alpha (empty domain_id) is an orphan.
		expect(feed.projectsByDomain.get("d-health")?.map((p) => p.name)).toEqual([
			"Run",
		]);
		expect(feed.orphans.map((p) => p.name)).toEqual(["Alpha"]);
	});

	it("re-emits when a project/domain edit lands", () => {
		const idx = seeded();
		const store = idx.projectsDomains();
		let feed = get(store);
		const health = feed.domains.find((d) => d.name === "Health")!;
		let ticks = 0;
		const unsub = store.subscribe(() => {
			ticks++;
		});
		idx.applyDomainEdit({ ...health, color: "#000000" });
		feed = get(store);
		expect(feed.domains.find((d) => d.name === "Health")?.color).toBe("#000000");
		expect(ticks).toBeGreaterThan(1); // initial + at least one update
		unsub();
	});

	it("nameCollision flags an existing name/alias, excluding self", () => {
		const idx = seeded();
		expect(idx.nameCollision("Health")).toBe("Health");
		expect(idx.nameCollision("Free Name")).toBeNull();
		const health = get(idx.projectsDomains()).domains.find(
			(d) => d.name === "Health",
		)!;
		expect(idx.nameCollision("Health", health)).toBeNull();
	});
});

// ─── backlog ───────────────────────────────────────────────────

describe("backlogSignature", () => {
	it("ignores source lines but reflects text/assoc/resurface", () => {
		const a: BacklogEntry[] = [
			{ source: { path: "Backlog.md", line: 0 }, text: "Buy milk" },
		];
		const b: BacklogEntry[] = [
			{ source: { path: "Backlog.md", line: 9 }, text: "Buy milk" },
		];
		expect(backlogSignature(a)).toBe(backlogSignature(b));

		const c: BacklogEntry[] = [
			{
				source: { path: "Backlog.md", line: 0 },
				text: "Buy milk",
				resurface: "2026-09-01",
			},
		];
		expect(backlogSignature(a)).not.toBe(backlogSignature(c));
	});
});

describe("KairosIndex backlog", () => {
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
			rename: async () => {},
			remove: async () => {},
			now: () => 1000,
			settings: PATHS,
			writeDebounceMs: 500,
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("seeds the backlog file into the backlog store", () => {
		const idx = new KairosIndex(deps);
		idx.seed([
			{ path: "Backlog.md", content: "- Buy milk\n- Draft [Thesis]\n", mtime: 1 },
		]);
		const entries = get(idx.backlog());
		expect(entries.map((e) => e.text)).toEqual(["Buy milk", "Draft"]);
		expect(entries[1]?.assoc).toEqual({ kind: "project", id: "Thesis" });
	});

	it("applyBacklogEdit notifies immediately and debounces the write", async () => {
		const idx = new KairosIndex(deps);
		idx.seed([]);
		const store = idx.backlog();

		idx.applyBacklogEdit([
			{ source: { path: "Backlog.md", line: -1 }, text: "New idea" },
		]);
		// Optimistic: store updated, no write yet.
		expect(get(store).map((e) => e.text)).toEqual(["New idea"]);
		expect(writes).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(500);
		expect(writes).toHaveLength(1);
		expect(writes[0]?.path).toBe("Backlog.md");
		expect(writes[0]?.content).toBe("- New idea\n");
	});

	it("drops the echo of its own write (signature match)", () => {
		const idx = new KairosIndex(deps);
		idx.seed([{ path: "Backlog.md", content: "- A\n", mtime: 1 }]);
		const store = idx.backlog();
		let notifications = 0;
		store.subscribe(() => notifications++); // fires once on subscribe
		const before = notifications;

		// Same list, different formatting/line: no observable change.
		idx.onFileChanged("Backlog.md", "\n- A\n", 2);
		expect(notifications).toBe(before);

		// A genuine change notifies.
		idx.onFileChanged("Backlog.md", "- A\n- B\n", 3);
		expect(notifications).toBe(before + 1);
		expect(get(store).map((e) => e.text)).toEqual(["A", "B"]);
	});

	it("scheduleEntry removes the entry and adds an Unscheduled task", () => {
		const idx = new KairosIndex(deps);
		idx.seed([
			{
				path: "Backlog.md",
				content: "- Write intro [Thesis]\n- Other\n",
				mtime: 1,
			},
		]);
		const [entry] = get(idx.backlog());
		expect(entry).toBeDefined();

		const date = "2026-07-31";
		const path = dayPath(date);
		idx.scheduleEntry(entry!, date, path, (blocks) =>
			addTaskToUnscheduled(blocks, path, entry!.text, entry!.assoc),
		);

		// Removed from the backlog…
		expect(get(idx.backlog()).map((e) => e.text)).toEqual(["Other"]);
		// …and present as an Unscheduled task carrying the association forward.
		const day = get(idx.day(date));
		const inbox = day?.blocks.find((b) => b.title === "Unscheduled");
		expect(inbox?.tasks[0]?.text).toBe("Write intro");
		expect(inbox?.tasks[0]?.assoc).toEqual({ kind: "project", id: "Thesis" });
	});

	it("returnToBacklog appends a new entry and drops the day task", () => {
		const idx = new KairosIndex(deps);
		const date = "2026-07-31";
		const path = dayPath(date);
		idx.seed([
			{
				path,
				content: note("- Unscheduled\n\t- [ ] Loose thing [Life]"),
				mtime: 1,
			},
			{ path: "Backlog.md", content: "- Existing\n", mtime: 1 },
		]);

		const day = get(idx.day(date));
		const inbox = day!.blocks.find((b) => b.title === "Unscheduled")!;
		const task = inbox.tasks[0]!;

		const newEntry: BacklogEntry = {
			source: { path: "Backlog.md", line: -1 },
			text: task.text,
			...(task.assoc ? { assoc: task.assoc } : {}),
		};
		idx.returnToBacklog(
			date,
			path,
			(blocks) =>
				blocks.map((b) =>
					b.title === "Unscheduled"
						? { ...b, tasks: b.tasks.filter((t) => t !== task) }
						: b,
				),
			newEntry,
		);

		// New backlog entry appended…
		expect(get(idx.backlog()).map((e) => e.text)).toEqual([
			"Existing",
			"Loose thing",
		]);
		// …and the day task is gone.
		const after = get(idx.day(date));
		const inboxAfter = after?.blocks.find((b) => b.title === "Unscheduled");
		expect(inboxAfter?.tasks ?? []).toHaveLength(0);
	});
});
