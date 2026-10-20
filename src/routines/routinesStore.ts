// The live routines file — the Obsidian glue behind the Routines view and
// "Repeat…".
//
// Keeps a parsed copy of the routines file in a Svelte store, re-read whenever
// the file is created, modified, renamed or deleted, or the path setting
// changes. Every write goes through `edit`, which applies one pure
// routinesWriter edit atomically (`vault.process`), creating the file (and its
// folder) on the first write. A `RoutinesConflict` — the file changed between
// reading and writing — is reported and the store re-read, never forced.

import { Notice, TFile, normalizePath } from "obsidian";
import { writable, type Readable } from "svelte/store";
import type Kairos from "../main";
import { parseRoutines, type ParsedRoutines } from "./routinesFile";
import { RoutinesConflict } from "./routinesWriter";

const EMPTY: ParsedRoutines = { routines: [], problems: [] };

export class RoutinesStore {
	private store = writable<ParsedRoutines>(EMPTY);
	/** The parsed routines file; empty when it doesn't exist. */
	readonly parsed$: Readable<ParsedRoutines> = { subscribe: this.store.subscribe };
	private path = "";

	constructor(private plugin: Kairos) {}

	start(): void {
		const { app } = this.plugin;
		this.plugin.register(
			this.plugin.settings$.subscribe((s) => {
				const path = normalizePath(s.routinesPath);
				if (path === this.path) return;
				this.path = path;
				void this.reload();
			}),
		);
		const onChange = (file: { path: string }, oldPath?: string) => {
			if (file.path === this.path || oldPath === this.path) void this.reload();
		};
		this.plugin.registerEvent(app.vault.on("create", (f) => onChange(f)));
		this.plugin.registerEvent(app.vault.on("modify", (f) => onChange(f)));
		this.plugin.registerEvent(app.vault.on("delete", (f) => onChange(f)));
		this.plugin.registerEvent(app.vault.on("rename", (f, old) => onChange(f, old)));
	}

	/** The routines file's path, as the setting names it. */
	get filePath(): string {
		return this.path;
	}

	private file(): TFile | null {
		const f = this.plugin.app.vault.getAbstractFileByPath(this.path);
		return f instanceof TFile ? f : null;
	}

	async reload(): Promise<void> {
		const file = this.file();
		this.store.set(file ? parseRoutines(await this.plugin.app.vault.read(file)) : EMPTY);
	}

	/**
	 * Apply one edit to the file's text. Returns false (after telling the user)
	 * when the file changed underneath and the edit was not made.
	 */
	async edit(change: (markdown: string) => string): Promise<boolean> {
		const { vault } = this.plugin.app;
		try {
			const file = this.file();
			if (file) {
				await vault.process(file, change);
			} else {
				await this.ensureFolder();
				await vault.create(this.path, change(""));
			}
			await this.reload();
			return true;
		} catch (err) {
			if (!(err instanceof RoutinesConflict)) throw err;
			await this.reload();
			new Notice(`${this.path} changed while you were editing it. Try again.`);
			return false;
		}
	}

	/** Open the routines file in a new tab, for editing by hand. */
	async openFile(): Promise<void> {
		const file = this.file();
		if (file) await this.plugin.app.workspace.getLeaf("tab").openFile(file);
	}

	private async ensureFolder(): Promise<void> {
		const slash = this.path.lastIndexOf("/");
		if (slash < 0) return;
		const folder = this.path.slice(0, slash);
		if (!this.plugin.app.vault.getAbstractFileByPath(folder)) {
			await this.plugin.app.vault.createFolder(folder);
		}
	}
}
