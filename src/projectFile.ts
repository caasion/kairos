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
