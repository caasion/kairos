// The "no" half of the normalisation offer (#28).
//
// Kairos never silently rewrites frontmatter it did not write (decision 55), so
// a file carrying a `status:` shape we would not have produced gets an offer
// rather than a rewrite: here is what we found, here is what it would become,
// accept or leave it. The offer is worth nothing unless declining sticks — an
// offer that comes back on every reindex is the same as no choice at all — so
// the decline is written to disk, not held in memory and not held in the view.
//
// It lives in its own small JSON file under the plugin folder rather than in
// plugin settings: it is a growing list of per-file answers, not configuration,
// nothing in the settings tab would ever show it, and keeping it separate means
// a settings save and a decline can't clobber each other.
//
// Storage is injected (`DeclineStore`) so the whole thing runs under vitest with
// no vault; `vaultDeclineStore` is the one binding to the real app, and only its
// *type* comes from obsidian, so importing this module never loads the API.

import type { App } from "obsidian";
import type { Domain, Project } from "./types";

/** Where a decline is kept. The vault binding is `vaultDeclineStore`. */
export interface DeclineStore {
	/** The stored text, or null when nothing has been stored yet. */
	read(): Promise<string | null>;
	write(text: string): Promise<void>;
}

/** The plugin's own folder, by the manifest id (stable API — never renamed). */
const PLUGIN_ID = "kairos";

/** Filename under the plugin folder. Not `data.json`: that is the settings file. */
export const DECLINES_FILE = "status-normalization.json";

/** The on-disk shape. Versioned so a later format change can migrate rather than guess. */
interface DeclineFile {
	version: 1;
	declined: string[];
}

/**
 * A store backed by the plugin folder (`.obsidian/plugins/kairos/…`). Uses the
 * vault *adapter* rather than the vault API because the config folder holds no
 * `TFile`s. A read failure is treated as "nothing declined yet": the cost of
 * getting that wrong is one extra offer, which the user can decline again.
 */
export function vaultDeclineStore(app: App): DeclineStore {
	const path = `${app.vault.configDir}/plugins/${PLUGIN_ID}/${DECLINES_FILE}`;
	return {
		async read() {
			try {
				if (!(await app.vault.adapter.exists(path))) return null;
				return await app.vault.adapter.read(path);
			} catch {
				return null;
			}
		},
		async write(text) {
			await app.vault.adapter.write(path, text);
		},
	};
}

/**
 * The set of entities whose offer has been declined. Load once, ask freely,
 * and each `decline` rewrites the whole (small) file so a crash between calls
 * can't leave a half-written list.
 */
export class NormalizationDeclines {
	private declined: Set<string>;

	private constructor(
		private store: DeclineStore,
		declined: Set<string>,
	) {
		this.declined = declined;
	}

	/**
	 * Read the stored declines. Anything unreadable or unrecognised reads as
	 * empty, including a store whose `read` rejects: loading is what gates the
	 * offer being shown at all, so it must resolve. The cost of reading an
	 * unreadable file as "nothing declined" is one extra offer.
	 */
	static async load(store: DeclineStore): Promise<NormalizationDeclines> {
		let text: string | null = null;
		try {
			text = await store.read();
		} catch {
			text = null;
		}
		return new NormalizationDeclines(store, parseDeclines(text));
	}

	has(key: string): boolean {
		return this.declined.has(key);
	}

	/**
	 * Record a "leave it alone" for `key`, durably. Declining twice is a no-op.
	 * The whole (small) list is rewritten each time, so a crash between calls
	 * can't leave a half-written file. The in-memory set is updated only after
	 * the write lands: a decline that didn't reach disk would otherwise hide the
	 * offer for this session and bring it back in the next one, which is the one
	 * behaviour #28 rules out. The rejection reaches the caller, which says so.
	 */
	async decline(key: string): Promise<void> {
		if (this.declined.has(key)) return;
		const next = new Set(this.declined).add(key);
		const data: DeclineFile = {
			version: 1,
			declined: [...next].sort(),
		};
		await this.store.write(JSON.stringify(data, null, "\t"));
		this.declined = next;
	}

	/** A snapshot, for tests and for anything that wants to show the list. */
	keys(): string[] {
		return [...this.declined].sort();
	}
}

/** Tolerant read: a missing, empty, malformed or foreign file means nothing declined. */
function parseDeclines(text: string | null): Set<string> {
	if (!text) return new Set();
	try {
		const value = JSON.parse(text) as unknown;
		if (!value || typeof value !== "object") return new Set();
		const list = (value as { declined?: unknown }).declined;
		if (!Array.isArray(list)) return new Set();
		return new Set(list.filter((k): k is string => typeof k === "string"));
	} catch {
		return new Set();
	}
}

/**
 * What a decline is filed under. The entity's frontmatter `id` when it has one,
 * so renaming or moving the file — a rename *is* a file move here, since the
 * name is the filename — doesn't bring the offer back. Files written by hand
 * (exactly the ones that carry anomalies) may have no id, so the path is the
 * fallback; a rename of one of those does re-offer, which is the safe direction
 * to fail in.
 */
export function declineKey(entity: Project | Domain): string {
	return entity.id ? `id:${entity.id}` : `path:${entity.source.path}`;
}
