// Kairos project & domain file parsing/serialization.
//
// Project and domain metadata lives entirely in a file's YAML frontmatter,
// identified by a `kairos/project` or `kairos/domain` tag. The body of the file
// is the user's own notes (the "folder note" hub) and is never touched here.
//
// Pure and vault-free: takes file text + path, returns a `Project`/`Domain`.
// The `yaml` library is a plain-JS dependency, so this runs under vitest.
//
// Status is stored as a `YYYY-MM-DD: state` map in frontmatter and parsed into a
// chronologically-sorted `StatusRecord[]`. `archived` is derived: a project or
// domain is archived iff its most recent status record is `archived`.

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
	Domain,
	ISODate,
	LifecycleState,
	Project,
	SourceRef,
	StatusRecord,
} from "./types";

const PROJECT_TAG = "kairos/project";
const DOMAIN_TAG = "kairos/domain";

// ─── frontmatter extraction ────────────────────────────────────

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Pull the raw YAML frontmatter block out of a file, or null if absent. */
export function extractFrontmatter(content: string): string | null {
	const m = FRONTMATTER.exec(content);
	return m ? (m[1] ?? "") : null;
}

/**
 * Replace a file's frontmatter fence with `fence` (a full `---…---\n` block),
 * leaving the body untouched. When the file has no frontmatter, the fence is
 * prepended. This is how a metadata edit persists without disturbing the user's
 * folder-note prose — the mirror of how the day writer splices the schedule
 * section rather than overwriting the note.
 */
export function replaceFrontmatter(content: string, fence: string): string {
	const m = FRONTMATTER.exec(content);
	// The fence already ends in a newline; keep exactly one blank line before body.
	if (!m) return `${fence}${content.startsWith("\n") ? "" : "\n"}${content}`;
	const body = content.slice(m[0].length).replace(/^\r?\n/, "");
	return `${fence}\n${body}`;
}

interface RawFrontmatter {
	tags?: unknown;
	id?: unknown;
	aliases?: unknown;
	domain_id?: unknown;
	order?: unknown;
	color?: unknown;
	status?: unknown;
}

function parseFrontmatter(content: string): RawFrontmatter | null {
	const raw = extractFrontmatter(content);
	if (raw === null) return null;
	try {
		const value = parseYaml(raw) as unknown;
		return value && typeof value === "object" ? (value as RawFrontmatter) : {};
	} catch {
		return null; // malformed YAML — treat as not-a-Kairos-file
	}
}

// ─── file-kind detection ───────────────────────────────────────

function hasTag(fm: RawFrontmatter, tag: string): boolean {
	const tags = fm.tags;
	if (Array.isArray(tags)) return tags.some((t) => t === tag);
	return tags === tag;
}

/** True iff `content`'s frontmatter marks it a Kairos project file. */
export function isProjectFile(content: string): boolean {
	const fm = parseFrontmatter(content);
	return fm !== null && hasTag(fm, PROJECT_TAG);
}

/** True iff `content`'s frontmatter marks it a Kairos domain file. */
export function isDomainFile(content: string): boolean {
	const fm = parseFrontmatter(content);
	return fm !== null && hasTag(fm, DOMAIN_TAG);
}

// ─── shared field coercion ─────────────────────────────────────

function asString(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

function asStringList(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === "string");
}

const LIFECYCLE = new Set<LifecycleState>(["active", "inactive", "archived"]);

/**
 * Parse the `status` frontmatter map into records sorted oldest→newest by date.
 * Keys are `YYYY-MM-DD`; values are lifecycle states. Unknown states and
 * malformed dates are dropped rather than throwing.
 */
export function parseStatus(v: unknown): StatusRecord[] {
	if (!v || typeof v !== "object") return [];
	const records: StatusRecord[] = [];
	for (const [date, state] of Object.entries(v as Record<string, unknown>)) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
		const status = String(state) as LifecycleState;
		if (!LIFECYCLE.has(status)) continue;
		records.push({ date: date as ISODate, status });
	}
	records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	return records;
}

/** Archived iff the most recent status record is `archived`. */
function deriveArchived(history: StatusRecord[]): boolean {
	return history.at(-1)?.status === "archived";
}

/** Base name of a file path, without extension — the project/domain name. */
function nameFromPath(path: string): string {
	const base = path.split("/").at(-1) ?? path;
	return base.replace(/\.md$/i, "");
}

// ─── project ───────────────────────────────────────────────────

/**
 * Parse a project file into a `Project`. Returns null if the file isn't a
 * Kairos project. The project's display name is its filename (associations
 * match by name), with the frontmatter carrying stable metadata.
 */
export function parseProject(content: string, path: string): Project | null {
	const fm = parseFrontmatter(content);
	if (fm === null || !hasTag(fm, PROJECT_TAG)) return null;

	const history = parseStatus(fm.status);
	const source: SourceRef = { path, line: 0 };
	const domain = asString(fm.domain_id);

	return {
		id: asString(fm.id) ?? "",
		name: nameFromPath(path),
		aliases: asStringList(fm.aliases),
		...(domain ? { domain } : {}),
		history,
		archived: deriveArchived(history),
		source,
	};
}

// ─── domain ────────────────────────────────────────────────────

/** Parse a domain file into a `Domain`, or null if it isn't one. */
export function parseDomain(content: string, path: string): Domain | null {
	const fm = parseFrontmatter(content);
	if (fm === null || !hasTag(fm, DOMAIN_TAG)) return null;

	const history = parseStatus(fm.status);
	const source: SourceRef = { path, line: 0 };
	const order = typeof fm.order === "number" ? fm.order : 0;

	return {
		id: asString(fm.id) ?? "",
		name: nameFromPath(path),
		aliases: asStringList(fm.aliases),
		order,
		color: asString(fm.color) ?? "",
		history,
		archived: deriveArchived(history),
		source,
	};
}

// ─── serialization ─────────────────────────────────────────────

/** Turn a `StatusRecord[]` back into a frontmatter status map. */
function statusMap(history: StatusRecord[]): Record<string, LifecycleState> {
	const map: Record<string, LifecycleState> = {};
	for (const r of history) map[r.date] = r.status;
	return map;
}

/**
 * Build the frontmatter block (between `---` fences) for a project. The body of
 * the file is the caller's concern — this only owns metadata.
 */
export function serializeProjectFrontmatter(project: Project): string {
	const fm: Record<string, unknown> = {
		tags: [PROJECT_TAG],
		id: project.id,
		aliases: project.aliases,
		domain_id: project.domain ?? null,
		status: statusMap(project.history),
	};
	return fence(fm);
}

/** Build the frontmatter block for a domain. */
export function serializeDomainFrontmatter(domain: Domain): string {
	const fm: Record<string, unknown> = {
		tags: [DOMAIN_TAG],
		id: domain.id,
		aliases: domain.aliases,
		order: domain.order,
		color: domain.color,
		status: statusMap(domain.history),
	};
	return fence(fm);
}

function fence(fm: Record<string, unknown>): string {
	return `---\n${stringifyYaml(fm)}---\n`;
}

// ─── file creation ─────────────────────────────────────────────
//
// A brand-new project/domain is a file: frontmatter plus an empty folder-note
// body the user fills in (spec §4.4 "recommended through the interface so all
// frontmatter fields get initialized"). The name is the filename, so the caller
// builds the path from `<folder>/<name>.md`; these produce the file contents.

/** A short random id, stable for the life of the project/domain file. */
function freshId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * A newly-created project, initialized `active` as of `today` (spec §4.4). Name
 * is the caller's responsibility to keep collision-free (`renameGuard`).
 */
export function newProject(name: string, today: ISODate, domainId?: string): Project {
	const history: StatusRecord[] = [{ date: today, status: "active" }];
	return {
		id: freshId(),
		name: name.trim(),
		aliases: [],
		...(domainId ? { domain: domainId } : {}),
		history,
		archived: false,
		source: { path: "", line: 0 },
	};
}

/** A newly-created domain, initialized `active` as of `today`. Durable: never archived. */
export function newDomain(name: string, today: ISODate, order: number): Domain {
	const history: StatusRecord[] = [{ date: today, status: "active" }];
	return {
		id: freshId(),
		name: name.trim(),
		aliases: [],
		order,
		color: "",
		history,
		archived: false,
		source: { path: "", line: 0 },
	};
}

/** Full file contents for a new project: frontmatter fence + folder-note stub. */
export function serializeProjectFile(project: Project): string {
	return `${serializeProjectFrontmatter(project)}\n# ${project.name}\n`;
}

/** Full file contents for a new domain. */
export function serializeDomainFile(domain: Domain): string {
	return `${serializeDomainFrontmatter(domain)}\n# ${domain.name}\n`;
}

// ─── pure edit functions ───────────────────────────────────────
//
// Each takes an entity and returns a NEW entity — never mutates. They own no
// I/O and no markdown; the index serializes the result and writes it. Status
// history is the one time-varying fact these carry (spec §4.4): editing it means
// appending a record, never rewriting the past. `archived` is always re-derived
// from the (possibly new) latest record so it can't drift out of sync.
//
// Domains are DURABLE (they never terminate as an identity): a domain may go
// active/inactive but is never archived. `appendStatus` enforces that by
// refusing an `archived` transition on a domain; a project may archive freely.

/** True for a `Project` (has a `domain?` field); false for a `Domain`. */
function isProject(entity: Project | Domain): entity is Project {
	return "domain" in entity || !("order" in entity);
}

/**
 * Append a status record dated `date` (spec §4.4). Additive: it never edits an
 * existing record, so the history stays a faithful log of when focus shifted.
 * A same-day re-status replaces that day's record (one status per day) rather
 * than stacking two. `archived` is re-derived from the resulting latest record.
 *
 * Domains cannot be archived (they are durable, spec §2.5 as constrained): an
 * `archived` transition on a domain is rejected and the entity returned
 * unchanged. Callers should gate the UI so this never fires, but the guard keeps
 * the invariant true even if it does.
 */
export function appendStatus<T extends Project | Domain>(
	entity: T,
	date: ISODate,
	status: LifecycleState,
): T {
	if (!isProject(entity) && status === "archived") return entity;

	const history = entity.history.filter((r) => r.date !== date);
	history.push({ date, status });
	history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	return { ...entity, history, archived: deriveArchived(history) };
}

/**
 * Rename by recording the old name as an alias (spec §4.4), so daily-note tags
 * written against the old name still resolve. The entity's `name` is its
 * filename, so the actual rename is a file move the caller performs; this only
 * updates the metadata that travels with it. A no-op rename (same name) returns
 * the entity untouched. The caller must run `renameGuard` first — this does not
 * check for collisions itself.
 */
export function renameWithAlias<T extends Project | Domain>(
	entity: T,
	newName: string,
): T {
	const next = newName.trim();
	if (next === "" || next === entity.name) return entity;
	const aliases = entity.aliases.includes(entity.name)
		? entity.aliases
		: [...entity.aliases, entity.name];
	return { ...entity, name: next, aliases };
}

/**
 * Whether `newName` collides with an existing project/domain name OR alias
 * (spec §4.4 rename conflict guard). Association is by exact name match, so a
 * duplicate name or alias would make a daily-note tag ambiguous; a create or
 * rename that collides must be refused. Comparison is case-insensitive and
 * trims, matching how a user perceives "the same name". `self` is the entity
 * being renamed (excluded so renaming to your own current name/alias is fine).
 *
 * Returns the canonical name it collides with, or null when the name is free.
 */
export function renameGuard(
	newName: string,
	projects: Map<string, Project>,
	domains: Map<string, Domain>,
	self?: Project | Domain,
): string | null {
	const target = newName.trim().toLowerCase();
	if (target === "") return null;

	const clash = (entity: Project | Domain): string | null => {
		if (self && entity.source.path === self.source.path) return null;
		if (entity.name.toLowerCase() === target) return entity.name;
		for (const alias of entity.aliases) {
			if (alias.toLowerCase() === target) return entity.name;
		}
		return null;
	};

	for (const p of projects.values()) {
		const hit = clash(p);
		if (hit) return hit;
	}
	for (const d of domains.values()) {
		const hit = clash(d);
		if (hit) return hit;
	}
	return null;
}

/** Set a domain's color (any CSS color string; "" clears it). */
export function setColor(domain: Domain, color: string): Domain {
	return { ...domain, color: color.trim() };
}

/** Set a domain's sort order among domains (the page's row order). */
export function setOrder(domain: Domain, order: number): Domain {
	return { ...domain, order };
}

/**
 * Point a project at a domain by the domain's stable `id`, or clear it with
 * `undefined` (spec §2.2: nothing is required to have a domain). At most one
 * domain (spec §2.4). The link is by id, not name, so a later domain rename
 * never orphans the project (see `association.ts`).
 */
export function setDomain(project: Project, domainId: string | undefined): Project {
	if (!domainId) {
		const { domain: _drop, ...rest } = project;
		return rest;
	}
	return { ...project, domain: domainId };
}
