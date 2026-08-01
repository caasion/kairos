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

import { writable } from "svelte/store";
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
import { DEFAULT_HEADING, spliceSection } from "./section";
import { resolveBlocks } from "./resolver";
import { parseDomain, parseProject } from "./projectFile";
import { resolveAssociation } from "./association";
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

	return { ...state, byProject, byDomain };
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

// ─── the live index (stores + watcher shell) ───────────────────

/** What the live index needs from the outside world beyond file routing. */
export interface IndexDeps {
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	now(): number;
	settings: IndexPaths;
	writeDebounceMs: number;
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
	private writeTimers = new Map<ISODate, ReturnType<typeof setTimeout>>();

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
				// TODO: backlog branch once its shape lands.
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
	 * A live association resolver. Subscribe to re-render when project/domain
	 * files change; the yielded function maps a raw `Association` to its display
	 * name, domain color, and navigation target.
	 */
	resolver(): Readable<Resolver> {
		return this.resolverStore;
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
			// TODO: backlog branch once its shape lands.
		}
	}

	private onDayChanged(
		path: string,
		date: ISODate,
		content: string,
		mtime: number,
	): void {
		const prev = this.state.days.get(date);
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

	private scheduleWrite(date: ISODate, path: string): void {
		const existing = this.writeTimers.get(date);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this.writeTimers.delete(date);
			void this.writeDay(date, path);
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
	private async writeDay(date: ISODate, path: string): Promise<void> {
		const latest = this.state.days.get(date);
		if (!latest) return;
		const heading = this.deps.settings.scheduleHeading;
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
	}

	private publishAll(): void {
		for (const [date, store] of this.dayStores) {
			store.set(this.state.days.get(date));
		}
		this.publishProjectsAndDomains();
		this.backlogStore.set(this.state.backlog);
	}
}
