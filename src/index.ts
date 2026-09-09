// Kairos index — the in-memory derived layer every view reads from.
//
// This module is the engine: it owns per-file reparse, the day signature used
// for echo-dedup, the byProject/byDomain rollups, and the Svelte stores views
// subscribe to. It is the ONE place mediating between markdown and the UI.
//
// The `obsidian-daily-notes-interface` import below is the only app dependency;
// unit tests mock that module (`vi.mock`) so the whole engine runs under vitest
// with no live app.
//
// Design rules that keep it debuggable:
//   • The file is the source of truth. `daySignature` compares the *parsed*
//     schedule, so an external edit that doesn't change the schedule — or an
//     echo of our own write — produces an equal signature and notifies no one.
//   • `applyDayEdit` is optimistic: it updates memory + notifies immediately,
//     then debounces the file write. The later `modify` echo is dropped by the
//     signature check, so the view never bounces.
//
// TODO seams (filled once the data shapes land): project/domain/backlog parsing
// and the alias resolution folded into `ownerKey`.

import { derived, writable } from "svelte/store";
import type { Readable, Writable } from "svelte/store";
import { getDateFromPath } from "obsidian-daily-notes-interface";
import type {
	Association,
	BacklogEntry,
	Block,
	Day,
	Domain,
	Index,
	ISODate,
	Project,
	ResolvedTask,
	SourceRef,
} from "./types";
import { parseSchedule } from "./parser";
import { serialize } from "./serializer";
import { parseBacklog, serializeBacklog } from "./backlog";
import { DEFAULT_HEADING, spliceSection } from "./section";
import { resolveBlocks } from "./resolver";
import {
	newDomain,
	newProject,
	parseDomain,
	parseProject,
	renameGuard,
	replaceFrontmatter,
	serializeDomainFile,
	serializeDomainFrontmatter,
	serializeProjectFile,
	serializeProjectFrontmatter,
} from "./projectFile";
import { domainProjects, resolveAssociation } from "./association";
import type { ResolvedAssociation } from "./association";
import { associationOptions } from "./associationOptions";
import type { AssociationOption } from "./associationOptions";

/** A snapshot-time association resolver, handed to views for rendering. */
export type Resolver = (assoc: Association) => ResolvedAssociation;

// ─── file routing ──────────────────────────────────────────────

/** Folders/paths that route non-day files, plus the schedule-section heading. */
export interface IndexPaths {
	projectsFolder: string;
	domainsFolder: string;
	backlogPath: string;
	/** The daily-note section heading Kairos reads/writes, e.g. "## Schedule". */
	scheduleHeading: string;
}

export type FileKind =
	| { kind: "day"; date: ISODate }
	| { kind: "project" }
	| { kind: "domain" }
	| { kind: "backlog" }
	| { kind: "ignore" };

/** Is `path` the folder itself or something beneath it? */
function isUnder(path: string, folder: string): boolean {
	return folder !== "" && (path === folder || path.startsWith(folder + "/"));
}

/**
 * Route a path to the kind of file it is. Daily-note detection defers to the
 * Daily Notes plugin's own folder + format config (via `getDateFromPath`); the
 * rest route by Kairos's own settings. Called fresh per event so a just-created
 * or renamed note resolves against the current config, not a stale snapshot.
 */
export function classify(path: string, settings: IndexPaths): FileKind {
	const m = getDateFromPath(path, "day");
	if (m) return { kind: "day", date: m.format("YYYY-MM-DD") };
	if (path === settings.backlogPath) return { kind: "backlog" };
	if (isUnder(path, settings.projectsFolder)) return { kind: "project" };
	if (isUnder(path, settings.domainsFolder)) return { kind: "domain" };
	return { kind: "ignore" };
}

// ─── pure state ────────────────────────────────────────────────

/** The engine's internal mutable form; `Index` (types.ts) is the read shape. */
export type IndexState = Index;

export function emptyState(): IndexState {
	return {
		days: new Map(),
		projects: new Map(),
		domains: new Map(),
		backlog: [],
		byProject: new Map(),
		byDomain: new Map(),
		byDomainProjects: new Map(),
	};
}

/**
 * Recompute byProject / byDomain from every resolved task across all days. Runs
 * after any change to the day/project/domain maps.
 *
 * Buckets by an association's `id`. Alias resolution (old name → current
 * project) is not done yet — it needs the project/domain maps, which is your
 * half. The seam is `ownerKey`; extend it to canonicalize once aliases exist.
 */
export function deriveLookups(state: IndexState): IndexState {
	const byProject = new Map<string, ResolvedTask[]>();
	const byDomain = new Map<string, ResolvedTask[]>();

	for (const day of state.days.values()) {
		for (const task of resolveBlocks(day.blocks, day.date)) {
			const owner = task.owner;
			if (!owner) continue;
			const bucket = owner.kind === "project" ? byProject : byDomain;
			const key = ownerKey(owner.id);
			const list = bucket.get(key);
			if (list) list.push(task);
			else bucket.set(key, [task]);
		}
	}

	// Child projects per domain (by the domain's stable id), for the Grid view's
	// expand-domains toggle. Cheap to recompute alongside the task rollups since
	// both run on any project/domain/day change.
	const byDomainProjects = new Map<string, Project[]>();
	for (const domain of state.domains.values()) {
		byDomainProjects.set(domain.id, domainProjects(domain.id, state.projects));
	}

	return { ...state, byProject, byDomain, byDomainProjects };
}

/** Canonicalize an association id. TODO: fold in alias → current-name mapping. */
function ownerKey(id: string): string {
	return id;
}

/**
 * Reparse one daily note into the state. Pure: `mtime` is passed in rather than
 * looked up, so tests need no vault. Returns a NEW state (never mutates input).
 */
export function reindexDay(
	state: IndexState,
	path: string,
	date: ISODate,
	content: string,
	mtime: number,
	heading: string = DEFAULT_HEADING,
): IndexState {
	const day: Day = {
		date,
		path,
		mtime,
		blocks: parseSchedule(content, path, heading),
	};
	const days = new Map(state.days);
	days.set(date, day);
	return deriveLookups({ ...state, days });
}

/** Drop a day from the state (its file was deleted). */
export function removeDay(state: IndexState, date: ISODate): IndexState {
	if (!state.days.has(date)) return state;
	const days = new Map(state.days);
	days.delete(date);
	return deriveLookups({ ...state, days });
}

/**
 * Reparse a project file into the state, keyed by the project's name (since
 * associations match by name). A file that no longer parses as a project (tag
 * removed) drops any prior entry at `path`.
 */
export function reindexProject(
	state: IndexState,
	path: string,
	content: string,
): IndexState {
	const projects = new Map(state.projects);
	dropByPath(projects, path);
	const project = parseProject(content, path);
	if (project) projects.set(project.name, project);
	return deriveLookups({ ...state, projects });
}

/** Reparse a domain file into the state, keyed by the domain's name. */
export function reindexDomain(
	state: IndexState,
	path: string,
	content: string,
): IndexState {
	const domains = new Map(state.domains);
	dropByPath(domains, path);
	const domain = parseDomain(content, path);
	if (domain) domains.set(domain.name, domain);
	return deriveLookups({ ...state, domains });
}

/** Remove whatever project/domain a deleted file provided. */
export function removeProjectFile(state: IndexState, path: string): IndexState {
	const projects = new Map(state.projects);
	if (!dropByPath(projects, path)) return state;
	return deriveLookups({ ...state, projects });
}

export function removeDomainFile(state: IndexState, path: string): IndexState {
	const domains = new Map(state.domains);
	if (!dropByPath(domains, path)) return state;
	return deriveLookups({ ...state, domains });
}

/**
 * Reparse the global backlog file into the state. The backlog is a single flat
 * file (spec §2.6), so — unlike days/projects/domains — reindexing replaces the
 * whole list rather than one keyed entry. Backlog entries are not tasks and
 * feed no rollup, so `deriveLookups` need not rerun; the caller republishes the
 * backlog store directly.
 */
export function reindexBacklog(
	state: IndexState,
	path: string,
	content: string,
): IndexState {
	return { ...state, backlog: parseBacklog(content, path) };
}

/** Drop the backlog (its file was deleted): an empty list. */
export function removeBacklog(state: IndexState): IndexState {
	return { ...state, backlog: [] };
}

/**
 * Remove any entry sourced from `path`. Needed because these maps are keyed by
 * name, not path: a rename or a name change means the old key must be found via
 * its source. Returns whether anything was removed.
 */
function dropByPath(
	map: Map<string, { source: SourceRef }>,
	path: string,
): boolean {
	for (const [key, value] of map) {
		if (value.source.path === path) {
			map.delete(key);
			return true;
		}
	}
	return false;
}

// ─── day signature (echo-dedup) ────────────────────────────────

/**
 * A stable string over a day's *parsed schedule* — deliberately not the raw
 * file text. Two files differing only in whitespace, or in prose outside the
 * Schedule section, share a signature; an echo of our own write matches memory
 * and notifies no one. This is what stops the view bouncing after an edit.
 *
 * Order-sensitive (block order is meaningful) and covers everything the UI
 * renders: time, title, status, association, metadata, and each block's tasks.
 */
export function daySignature(blocks: Block[]): string {
	return JSON.stringify(blocks.map(blockSig));
}

function blockSig(b: Block): unknown {
	return [
		b.time ? [b.time.start, b.time.end] : null,
		b.title,
		b.status ?? null,
		b.assoc ? [b.assoc.kind, b.assoc.id] : null,
		b.metadata ?? null,
		b.tasks.map(taskSig),
	];
}

function taskSig(t: Block["tasks"][number]): unknown {
	return [
		t.text,
		t.status,
		t.assoc ? [t.assoc.kind, t.assoc.id] : null,
		t.metadata ?? null,
	];
}

/**
 * A stable string over the backlog's parsed entries — order-sensitive (entry
 * order is user-meaningful) and covering everything the view renders: text,
 * association, resurface date. Excludes `source.line`, which shifts on every
 * edit, so an echo of our own write matches memory and notifies no one.
 */
export function backlogSignature(entries: BacklogEntry[]): string {
	return JSON.stringify(
		entries.map((e) => [
			e.text,
			e.assoc ? [e.assoc.kind, e.assoc.id] : null,
			e.resurface ?? null,
		]),
	);
}

// ─── the live index (stores + watcher shell) ───────────────────

/** What the live index needs from the outside world beyond file routing. */
export interface IndexDeps {
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	/** Rename/move a file. Project/domain names ARE filenames, so a rename is a
	 *  file move, not a content edit — this is the write path a rename takes. */
	rename(oldPath: string, newPath: string): Promise<void>;
	/** Delete a file. Used when the user deletes a project/domain outright
	 *  (spec §4.4 — allowed, with a dangling-reference warning owned by the UI). */
	remove(path: string): Promise<void>;
	now(): number;
	settings: IndexPaths;
	writeDebounceMs: number;
}

/**
 * What the Projects & Domains page renders: domains as durable top-level rows
 * (ordered), each with its child projects, plus the projects that belong to no
 * domain. Everything is derived from the current project/domain maps and
 * re-emitted whenever they change (spec §5, §6 project page).
 */
export interface ProjectsDomains {
	domains: Domain[];
	projectsByDomain: Map<string, Project[]>;
	orphans: Project[];
}

/** What a project-page store yields: the project plus its resolved tasks. */
export interface ProjectView {
	project: Project;
	tasks: ResolvedTask[];
}

/** What a domain store yields: the domain plus its resolved tasks. */
export interface DomainView {
	domain: Domain;
	tasks: ResolvedTask[];
}

/**
 * One visible day in the Grid view: the calendar date, the note path (null when
 * no note exists yet — a cell edit creates it), the day's raw blocks (the write
 * surface a cell edit rebuilds), and its resolved tasks (what a cell renders).
 */
export interface GridDay {
	date: ISODate;
	path: string | null;
	blocks: Block[];
	tasks: ResolvedTask[];
}

/**
 * Everything the Grid view needs, recomputed reactively. `days` carries the
 * visible columns; `projects`/`domains`/`byDomainProjects` carry the row axis
 * (and the expand-domains children). A live resolver is bundled so cells tint
 * without a second subscription.
 */
export interface GridSnapshot {
	days: GridDay[];
	projects: Map<string, Project>;
	domains: Map<string, Domain>;
	byDomainProjects: Map<string, Project[]>;
	resolve: Resolver;
}

/**
 * Wraps the pure state in Svelte stores and the optimistic write path. The
 * vault watcher calls `onFileChanged` / `onFileDeleted`; the UI calls `day(date)`
 * to subscribe and `applyDayEdit` to mutate.
 */
export class KairosIndex {
	private state: IndexState = emptyState();

	private dayStores = new Map<ISODate, Writable<Day | undefined>>();
	private projectStores = new Map<string, Writable<ProjectView | undefined>>();
	private domainStores = new Map<string, Writable<DomainView | undefined>>();
	private backlogStore: Writable<BacklogEntry[]> = writable([]);
	// A resolver store: yields a fresh `(assoc) => ResolvedAssociation` whenever
	// the project/domain maps change, so views re-tint live on a file edit.
	private resolverStore: Writable<Resolver> = writable(() => ({
		displayName: "",
		resolved: false,
	}));
	// A monotonic counter bumped whenever the project/domain maps change. The Grid
	// view's derived store folds this in so a project/domain edit (which changes
	// row set, names, or colors) re-derives the grid even when no day changed.
	private structureVersion: Writable<number> = writable(0);
	private writeTimers = new Map<ISODate, ReturnType<typeof setTimeout>>();
	// The single global backlog file has one debounced write timer of its own,
	// keyed by nothing (there is only one backlog).
	private backlogWriteTimer?: ReturnType<typeof setTimeout>;

	constructor(private deps: IndexDeps) {
		this.resolverStore.set(this.makeResolver());
	}

	private makeResolver(): Resolver {
		const { projects, domains } = this.state;
		return (assoc) => resolveAssociation(assoc, projects, domains);
	}

	/** Seed the index from an initial batch of files (cold start). */
	seed(files: { path: string; content: string; mtime: number }[]): void {
		let state = emptyState();
		for (const f of files) {
			const what = classify(f.path, this.deps.settings);
			switch (what.kind) {
				case "day":
					state = reindexDay(
						state,
						f.path,
						what.date,
						f.content,
						f.mtime,
						this.deps.settings.scheduleHeading,
					);
					break;
				case "project":
					state = reindexProject(state, f.path, f.content);
					break;
				case "domain":
					state = reindexDomain(state, f.path, f.content);
					break;
				case "backlog":
					state = reindexBacklog(state, f.path, f.content);
					break;
			}
		}
		this.state = state;
		this.publishAll();
	}

	/** Read-only snapshot for one-off reads outside the store flow. */
	snapshot(): IndexState {
		return this.state;
	}

	/** Pickable associations (non-archived projects + domains) for the picker. */
	associationOptions(): AssociationOption[] {
		return associationOptions(this.state.projects, this.state.domains);
	}

	// ── subscriptions ──

	/** A live store of the day for `date` (undefined when no note exists). */
	day(date: ISODate): Readable<Day | undefined> {
		return this.ensureDayStore(date);
	}

	backlog(): Readable<BacklogEntry[]> {
		return this.backlogStore;
	}

	/**
	 * A live grid feed for a set of dates (the visible columns). Re-derives when
	 * any of those days change (its own edit or an external one) or when the
	 * project/domain structure changes (`structureVersion`). The row axis is
	 * carried as the current project/domain maps so the view groups tasks by
	 * owner and splits domains into child projects on demand.
	 *
	 * A cold `grid([...])` for dates never seen registers their day stores, so a
	 * later file event on those days flows straight through.
	 */
	grid(dates: ISODate[]): Readable<GridSnapshot> {
		const dayStores = dates.map((date) => this.ensureDayStore(date));
		const inputs: [Readable<number>, ...Readable<Day | undefined>[]] = [
			this.structureVersion,
			...dayStores,
		];

		return derived(inputs, ([, ...days]) => {
			const gridDays: GridDay[] = days.map((day, i) => {
				const date = dates[i]!;
				const blocks = day?.blocks ?? [];
				return {
					date,
					path: day?.path ?? null,
					blocks,
					tasks: resolveBlocks(blocks, date),
				};
			});

			return {
				days: gridDays,
				projects: this.state.projects,
				domains: this.state.domains,
				byDomainProjects: this.state.byDomainProjects,
				resolve: this.makeResolver(),
			};
		});
	}

	/**
	 * A live association resolver. Subscribe to re-render when project/domain
	 * files change; the yielded function maps a raw `Association` to its display
	 * name, domain color, and navigation target.
	 */
	resolver(): Readable<Resolver> {
		return this.resolverStore;
	}

	/**
	 * A live feed for the Projects & Domains page: domains (ordered) with their
	 * child projects, plus orphan projects. Re-derives on any project/domain edit
	 * via `structureVersion`, so a create/rename/recolor/reorder/status change
	 * re-renders the page. Includes archived entities; the view filters them.
	 */
	projectsDomains(): Readable<ProjectsDomains> {
		return derived(this.structureVersion, () => this.assembleProjectsDomains());
	}

	private assembleProjectsDomains(): ProjectsDomains {
		const { projects, domains } = this.state;

		const ordered = [...domains.values()].sort(
			(a, b) =>
				a.order - b.order ||
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
		);

		// Group projects by their domain id (the stable link, not name), so a
		// domain rename never re-buckets its projects. Unlinked or dangling-domain
		// projects fall to `orphans`.
		const domainIds = new Set([...domains.values()].map((d) => d.id));
		const projectsByDomain = new Map<string, Project[]>();
		const orphans: Project[] = [];
		const byName = (a: Project, b: Project) =>
			a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

		for (const p of [...projects.values()].sort(byName)) {
			if (p.domain && domainIds.has(p.domain)) {
				const bucket = projectsByDomain.get(p.domain) ?? [];
				bucket.push(p);
				projectsByDomain.set(p.domain, bucket);
			} else {
				orphans.push(p);
			}
		}

		return { domains: ordered, projectsByDomain, orphans };
	}

	/** A live store of a project and its resolved tasks (undefined if unknown). */
	project(name: string): Readable<ProjectView | undefined> {
		return this.ensureProjectStore(name);
	}

	/** A live store of a domain and its resolved tasks (undefined if unknown). */
	domain(name: string): Readable<DomainView | undefined> {
		return this.ensureDomainStore(name);
	}

	// ── vault events (called by the adapter) ──

	/** A file changed on disk (modify or create). Reparse and notify if it moved. */
	onFileChanged(path: string, content: string, mtime: number): void {
		const what = classify(path, this.deps.settings);
		switch (what.kind) {
			case "day":
				this.onDayChanged(path, what.date, content, mtime);
				return;
			case "project":
				this.state = reindexProject(this.state, path, content);
				this.publishProjectsAndDomains();
				return;
			case "domain":
				this.state = reindexDomain(this.state, path, content);
				this.publishProjectsAndDomains();
				return;
			case "backlog":
				this.onBacklogChanged(content);
				return;
		}
	}

	/**
	 * The backlog file changed. Reparse and republish — but drop an echo of our
	 * own write: an optimistic `applyBacklogEdit` already updated memory + the
	 * store, so a subsequent `modify` carrying an identical list must notify no
	 * one (the same discipline `onDayChanged` uses for the schedule).
	 */
	private onBacklogChanged(content: string): void {
		const path = this.deps.settings.backlogPath;
		const next = parseBacklog(content, path);
		if (backlogSignature(this.state.backlog) === backlogSignature(next)) return;
		this.state = { ...this.state, backlog: next };
		this.backlogStore.set(this.state.backlog);
	}

	private onDayChanged(
		path: string,
		date: ISODate,
		content: string,
		mtime: number,
	): void {
		const prev = this.state.days.get(date);
		// Pending-write gate: an edit for this date is committed in memory and
		// waiting on its debounced write, so memory — not the file — is the newer
		// version. This matters most on a *first* edit to a day with no note yet:
		// `ensureNoteForDate` creates the note, then applies the edit on the very
		// next microtask, while the vault's create event only reaches us after an
		// async read. That echo therefore always lands *after* the commit, carrying
		// the freshly-templated (scheduleless) file, and adopting it would drop the
		// edit from memory — which the pending write would then persist. The write
		// splices into whatever the file holds at write time, so nothing outside
		// the Schedule section is lost by skipping this parse.
		if (this.writeTimers.has(date)) return;

		// mtime gate: ignore stale echoes older than what we already hold.
		if (prev && mtime !== 0 && prev.mtime > mtime) return;

		const heading = this.deps.settings.scheduleHeading;
		const nextBlocks = parseSchedule(content, path, heading);
		// Echo-dedup: identical schedule ⇒ nothing the UI cares about changed.
		if (prev && daySignature(prev.blocks) === daySignature(nextBlocks)) {
			if (mtime !== 0) prev.mtime = mtime; // keep gating accurate
			return;
		}

		this.state = reindexDay(this.state, path, date, content, mtime, heading);
		this.publishDay(date);
		// A day's tasks feed project/domain views, so refresh those too.
		this.publishProjectsAndDomains();
	}

	/** A file was deleted on disk. */
	onFileDeleted(path: string): void {
		const what = classify(path, this.deps.settings);
		switch (what.kind) {
			case "day":
				this.state = removeDay(this.state, what.date);
				this.publishDay(what.date);
				this.publishProjectsAndDomains();
				return;
			case "project":
				this.state = removeProjectFile(this.state, path);
				this.publishProjectsAndDomains();
				return;
			case "domain":
				this.state = removeDomainFile(this.state, path);
				this.publishProjectsAndDomains();
				return;
			case "backlog":
				this.state = removeBacklog(this.state);
				this.backlogStore.set(this.state.backlog);
				return;
		}
	}

	// ── optimistic edit ──

	/**
	 * Apply a new set of blocks for a day: update memory + notify immediately
	 * (optimistic), then debounce the file write. The write's later `modify`
	 * echo is dropped by `onFileChanged`'s signature check.
	 */
	applyDayEdit(date: ISODate, path: string, blocks: Block[]): void {
		const prev = this.state.days.get(date);
		const day: Day = {
			date,
			path,
			mtime: prev?.mtime ?? this.deps.now(),
			blocks,
		};
		const days = new Map(this.state.days);
		days.set(date, day);
		this.state = deriveLookups({ ...this.state, days });
		this.publishDay(date);
		this.publishProjectsAndDomains();

		this.scheduleWrite(date, path);
	}

	/**
	 * CORE LOGIC — flagged for review. Apply a cross-day block move: the moved
	 * block leaves `fromDate`'s note and lands in `toDate`'s note. Both days'
	 * block arrays are already computed by `moveBlockAcrossDays` (the writer's
	 * pure primitive); this method commits them optimistically as one unit —
	 * both memory updates and notifications happen before either debounced write,
	 * so a view never observes the block present on neither day or on both.
	 *
	 * `toPath` may create the target daily note on first write, exactly as
	 * `applyDayEdit` does for an empty day. If either day is the same as the
	 * currently-open editor, the usual echo-dedup on the later write keeps the
	 * view from bouncing.
	 */
	applyCrossDayMove(
		fromDate: ISODate,
		fromPath: string,
		fromBlocks: Block[],
		toDate: ISODate,
		toPath: string,
		toBlocks: Block[],
	): void {
		const days = new Map(this.state.days);

		const prevFrom = days.get(fromDate);
		days.set(fromDate, {
			date: fromDate,
			path: fromPath,
			mtime: prevFrom?.mtime ?? this.deps.now(),
			blocks: fromBlocks,
		});

		const prevTo = days.get(toDate);
		days.set(toDate, {
			date: toDate,
			path: toPath,
			mtime: prevTo?.mtime ?? this.deps.now(),
			blocks: toBlocks,
		});

		this.state = deriveLookups({ ...this.state, days });
		this.publishDay(fromDate);
		this.publishDay(toDate);
		this.publishProjectsAndDomains();

		this.scheduleWrite(fromDate, fromPath);
		this.scheduleWrite(toDate, toPath);
	}

	// ── backlog edit + actions ──
	//
	// CORE LOGIC — flagged for review. The backlog is the second write surface
	// (after daily notes). Editing it follows the same optimistic discipline as
	// `applyDayEdit`: update memory + notify immediately, debounce the file write,
	// and drop the write's `modify` echo via `backlogSignature`. Because the
	// backlog owns its whole file, its write is a plain overwrite, not a splice.

	/**
	 * Apply a new backlog entry list: update memory + notify immediately, then
	 * debounce the file write. Every backlog mutation (create/edit/remove/reorder)
	 * routes through here so there is a single write path, exactly like the day's.
	 */
	applyBacklogEdit(entries: BacklogEntry[]): void {
		this.state = { ...this.state, backlog: entries };
		this.backlogStore.set(entries);
		this.scheduleBacklogWrite();
	}

	/**
	 * Schedule a backlog entry (spec §2.6): remove it from the backlog and create
	 * a task in `date`'s daily note, carrying the entry's association forward. The
	 * resulting task lands in the day's Unscheduled block — scheduling here means
	 * "give it a home in a day", not "assign a time"; the user times it later on
	 * the timeline. The backlog line simply disappears; no pointer links the task
	 * back to it.
	 *
	 * Both writes commit optimistically as one unit — the backlog store and the
	 * day store both update before either debounced write — so a view never sees
	 * the entry gone from the backlog yet absent from the day, or present in both.
	 *
	 * `addToDay` is the caller-supplied day transform (the writer's
	 * `addTaskToUnscheduled`), applied to the target day's current blocks. It is
	 * injected rather than imported so this engine stays free of the writer and
	 * unit-testable in isolation.
	 */
	scheduleEntry(
		entry: BacklogEntry,
		date: ISODate,
		path: string,
		addToDay: (blocks: Block[]) => Block[],
	): void {
		// Remove the consumed entry from the backlog (match by source line — the
		// stable handle every edit uses; text alone could collide across entries).
		const backlog = this.state.backlog.filter(
			(e) => e.source.line !== entry.source.line,
		);

		// Fold the new task into the target day's blocks.
		const prev = this.state.days.get(date);
		const blocks = addToDay(prev?.blocks ?? []);
		const day: Day = {
			date,
			path,
			mtime: prev?.mtime ?? this.deps.now(),
			blocks,
		};
		const days = new Map(this.state.days);
		days.set(date, day);

		this.state = deriveLookups({ ...this.state, days, backlog });
		this.backlogStore.set(this.state.backlog);
		this.publishDay(date);
		this.publishProjectsAndDomains();

		this.scheduleBacklogWrite();
		this.scheduleWrite(date, path);
	}

	/**
	 * Return a day task to the backlog (spec §2.6, §4.2 "special delete"):
	 * semantically create a *new* backlog entry and delete the day task. There is
	 * no restore of an original entry — the task's text and association seed a
	 * fresh entry appended to the backlog; no resurface date is set.
	 *
	 * The two writes commit as one optimistic unit, like `scheduleEntry` in
	 * reverse. `removeFromDay` is the caller-supplied day transform (the writer's
	 * `deleteTask`), applied to the day's current blocks. `newEntry` is the entry
	 * to append (text + association the caller lifted off the task).
	 */
	returnToBacklog(
		date: ISODate,
		path: string,
		removeFromDay: (blocks: Block[]) => Block[],
		newEntry: BacklogEntry,
	): void {
		const prev = this.state.days.get(date);
		const blocks = removeFromDay(prev?.blocks ?? []);
		const day: Day = {
			date,
			path,
			mtime: prev?.mtime ?? this.deps.now(),
			blocks,
		};
		const days = new Map(this.state.days);
		days.set(date, day);

		const backlog = [...this.state.backlog, newEntry];

		this.state = deriveLookups({ ...this.state, days, backlog });
		this.backlogStore.set(this.state.backlog);
		this.publishDay(date);
		this.publishProjectsAndDomains();

		this.scheduleBacklogWrite();
		this.scheduleWrite(date, path);
	}

	// ── project / domain edit + lifecycle ──
	//
	// CORE LOGIC — flagged for review. Project and domain files are the third and
	// fourth write surfaces. Their metadata lives in frontmatter, so a plain edit
	// (color, order, status, domain link) splices the frontmatter and leaves the
	// folder-note body alone — the same discipline the day writer uses for the
	// schedule section. Three operations are structural, not content edits:
	//   • rename — the name IS the filename, so it's a file move + rekey.
	//   • create — a brand-new file with initialized frontmatter.
	//   • delete — remove the file; tags still referencing it go dangling by
	//     design (spec §4.4), which the resolver already renders gracefully.
	// Unlike days/backlog these write EAGERLY (no debounce): edits are discrete UI
	// actions (a click on a swatch, a status pick), not a keystroke stream, so
	// there's nothing to coalesce and immediate persistence keeps the file honest.

	/**
	 * Persist a metadata edit to a project. Updates memory + republishes
	 * optimistically, then splices the new frontmatter into the file. The map is
	 * keyed by name; a metadata edit never changes the name (rename is separate),
	 * so the key is stable. The subsequent `modify` echo is absorbed by
	 * `reindexProject` re-deriving the same state.
	 */
	applyProjectEdit(project: Project): void {
		const projects = new Map(this.state.projects);
		projects.set(project.name, project);
		this.state = deriveLookups({ ...this.state, projects });
		this.publishProjectsAndDomains();
		void this.writeFrontmatter(
			project.source.path,
			serializeProjectFrontmatter(project),
		);
	}

	/** Persist a metadata edit to a domain (see `applyProjectEdit`). */
	applyDomainEdit(domain: Domain): void {
		const domains = new Map(this.state.domains);
		domains.set(domain.name, domain);
		this.state = deriveLookups({ ...this.state, domains });
		this.publishProjectsAndDomains();
		void this.writeFrontmatter(
			domain.source.path,
			serializeDomainFrontmatter(domain),
		);
	}

	/**
	 * Create a new project file under the projects folder and index it. `entity`
	 * already carries initialized frontmatter (`newProject`); this computes its
	 * path from the name, writes the file, and folds it into state so the page
	 * shows it before the vault event echoes back.
	 */
	async createProject(name: string, domainId?: string, description = ""): Promise<void> {
		const project = newProject(name, this.today(), domainId, description);
		const path = `${this.deps.settings.projectsFolder}/${name}.md`;
		project.source = { path, line: 0 };
		await this.deps.write(path, serializeProjectFile(project));
		const projects = new Map(this.state.projects);
		projects.set(project.name, project);
		this.state = deriveLookups({ ...this.state, projects });
		this.publishProjectsAndDomains();
	}

	/** Create a new domain file (next order = current count). */
	async createDomain(name: string, description = ""): Promise<void> {
		const domain = newDomain(name, this.today(), this.state.domains.size, description);
		const path = `${this.deps.settings.domainsFolder}/${name}.md`;
		domain.source = { path, line: 0 };
		await this.deps.write(path, serializeDomainFile(domain));
		const domains = new Map(this.state.domains);
		domains.set(domain.name, domain);
		this.state = deriveLookups({ ...this.state, domains });
		this.publishProjectsAndDomains();
	}

	/**
	 * Rename a project/domain: the entity already carries its new name + the old
	 * name pushed into `aliases` (`renameWithAlias`). Because the name is the
	 * filename, this moves the file, then rewrites frontmatter (the aliases
	 * changed) and rekeys the in-memory map. The caller must have cleared the
	 * collision guard (`renameGuard`) first.
	 */
	async renameProject(oldName: string, renamed: Project): Promise<void> {
		const oldPath = renamed.source.path;
		const newPath = `${this.deps.settings.projectsFolder}/${renamed.name}.md`;
		renamed.source = { path: newPath, line: 0 };
		await this.deps.rename(oldPath, newPath);
		await this.deps.write(newPath, replaceFrontmatter(
			await this.safeRead(newPath),
			serializeProjectFrontmatter(renamed),
		));
		const projects = new Map(this.state.projects);
		projects.delete(oldName);
		projects.set(renamed.name, renamed);
		this.state = deriveLookups({ ...this.state, projects });
		this.publishProjectsAndDomains();
	}

	async renameDomain(oldName: string, renamed: Domain): Promise<void> {
		const oldPath = renamed.source.path;
		const newPath = `${this.deps.settings.domainsFolder}/${renamed.name}.md`;
		renamed.source = { path: newPath, line: 0 };
		await this.deps.rename(oldPath, newPath);
		await this.deps.write(newPath, replaceFrontmatter(
			await this.safeRead(newPath),
			serializeDomainFrontmatter(renamed),
		));
		const domains = new Map(this.state.domains);
		domains.delete(oldName);
		domains.set(renamed.name, renamed);
		this.state = deriveLookups({ ...this.state, domains });
		this.publishProjectsAndDomains();
	}

	/**
	 * Delete a project/domain file (spec §4.4). Tags still naming it become
	 * dangling associations — the resolver renders them by literal name with no
	 * color, exactly as before any file existed, so nothing breaks. The UI owns
	 * the "archiving is usually better" warning.
	 */
	async deleteProject(name: string): Promise<void> {
		const project = this.state.projects.get(name);
		if (!project) return;
		await this.deps.remove(project.source.path);
		const projects = new Map(this.state.projects);
		projects.delete(name);
		this.state = deriveLookups({ ...this.state, projects });
		this.publishProjectsAndDomains();
	}

	async deleteDomain(name: string): Promise<void> {
		const domain = this.state.domains.get(name);
		if (!domain) return;
		await this.deps.remove(domain.source.path);
		const domains = new Map(this.state.domains);
		domains.delete(name);
		this.state = deriveLookups({ ...this.state, domains });
		this.publishProjectsAndDomains();
	}

	/** Collision check for a create/rename (spec §4.4). Exposes the pure guard
	 *  to the UI so it can warn before committing. Returns the clashing name or null. */
	nameCollision(name: string, self?: Project | Domain): string | null {
		return renameGuard(name, this.state.projects, this.state.domains, self);
	}

	private today(): ISODate {
		const d = new Date(this.deps.now());
		const p = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}

	private async safeRead(path: string): Promise<string> {
		try {
			return await this.deps.read(path);
		} catch {
			return "";
		}
	}

	/** Splice a new frontmatter fence into an existing file, preserving its body. */
	private async writeFrontmatter(path: string, fence: string): Promise<void> {
		const current = await this.safeRead(path);
		await this.deps.write(path, replaceFrontmatter(current, fence));
	}

	private scheduleBacklogWrite(): void {
		if (this.backlogWriteTimer) clearTimeout(this.backlogWriteTimer);
		this.backlogWriteTimer = setTimeout(() => {
			this.backlogWriteTimer = undefined;
			void this.writeBacklog();
		}, this.deps.writeDebounceMs);
	}

	/**
	 * Persist the backlog by overwriting its file with the serialized entry list
	 * (the backlog owns the whole file — no section to preserve). Serializes the
	 * *latest* entries, so a burst of edits collapses to one correct write.
	 */
	private async writeBacklog(): Promise<void> {
		const path = this.deps.settings.backlogPath;
		await this.deps.write(path, serializeBacklog(this.state.backlog));
	}

	private scheduleWrite(date: ISODate, path: string): void {
		const existing = this.writeTimers.get(date);
		if (existing) clearTimeout(existing);

		// Capture the heading now, at edit time. If the user changes the
		// schedule-heading setting during the debounce window, this write still
		// splices against the heading the note actually has, so it replaces the
		// existing section rather than appending a mismatched second one.
		const heading = this.deps.settings.scheduleHeading;
		const timer = setTimeout(() => {
			this.writeTimers.delete(date);
			void this.writeDay(date, path, heading);
		}, this.deps.writeDebounceMs);

		this.writeTimers.set(date, timer);
	}

	/**
	 * Persist a day by splicing its Schedule section into the note's existing
	 * text, leaving frontmatter, prose, and other headings untouched. Reads the
	 * current file first (empty string if it doesn't exist yet, so a brand-new
	 * note gets just the section). Serializes the *latest* blocks, not a stale
	 * closure, so a burst of edits collapses to one correct write.
	 */
	private async writeDay(
		date: ISODate,
		path: string,
		heading: string,
	): Promise<void> {
		const latest = this.state.days.get(date);
		if (!latest) return;
		const section = serialize(latest.blocks, heading);

		let current = "";
		try {
			current = await this.deps.read(path);
		} catch {
			// No file yet — splice into empty text yields just the section, which
			// the adapter's write creates.
		}

		await this.deps.write(path, spliceSection(current, section, heading));
	}

	/** Cancel timers so unload/stop leaks nothing. */
	dispose(): void {
		for (const t of this.writeTimers.values()) clearTimeout(t);
		this.writeTimers.clear();
		if (this.backlogWriteTimer) clearTimeout(this.backlogWriteTimer);
		this.backlogWriteTimer = undefined;
	}

	// ── store plumbing ──

	private ensureDayStore(date: ISODate): Writable<Day | undefined> {
		let store = this.dayStores.get(date);
		if (!store) {
			store = writable(this.state.days.get(date));
			this.dayStores.set(date, store);
		}
		return store;
	}

	private ensureProjectStore(name: string): Writable<ProjectView | undefined> {
		let store = this.projectStores.get(name);
		if (!store) {
			store = writable(this.projectView(name));
			this.projectStores.set(name, store);
		}
		return store;
	}

	private ensureDomainStore(name: string): Writable<DomainView | undefined> {
		let store = this.domainStores.get(name);
		if (!store) {
			store = writable(this.domainView(name));
			this.domainStores.set(name, store);
		}
		return store;
	}

	/** Assemble a project + its resolved tasks from current state. */
	private projectView(name: string): ProjectView | undefined {
		const project = this.state.projects.get(name);
		if (!project) return undefined;
		return { project, tasks: this.state.byProject.get(name) ?? [] };
	}

	private domainView(name: string): DomainView | undefined {
		const domain = this.state.domains.get(name);
		if (!domain) return undefined;
		return { domain, tasks: this.state.byDomain.get(name) ?? [] };
	}

	private publishDay(date: ISODate): void {
		const store = this.dayStores.get(date);
		if (store) store.set(this.state.days.get(date));
	}

	/**
	 * Republish every subscribed project/domain store. Called whenever either
	 * the metadata (project/domain files) or the task rollups (day edits) change,
	 * since a project view depends on both.
	 */
	private publishProjectsAndDomains(): void {
		for (const [name, store] of this.projectStores) {
			store.set(this.projectView(name));
		}
		for (const [name, store] of this.domainStores) {
			store.set(this.domainView(name));
		}
		// The resolver closes over the project/domain maps, so a change here must
		// hand views a fresh function to trigger a re-tint.
		this.resolverStore.set(this.makeResolver());
		// Bump the structure version so the Grid's derived store re-derives its
		// rows (a new/renamed/recolored project or domain changes the grid shape).
		this.structureVersion.update((n) => n + 1);
	}

	private publishAll(): void {
		for (const [date, store] of this.dayStores) {
			store.set(this.state.days.get(date));
		}
		this.publishProjectsAndDomains();
		this.backlogStore.set(this.state.backlog);
	}
}
