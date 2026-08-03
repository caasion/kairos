// Vault adapter — the thin shell that makes `KairosIndex` live in Obsidian.
//
// This is the ONLY place the engine touches the real app. It:
//   • builds `IndexDeps` from `app.vault` (read/write/now/settings),
//   • does the cold-start `seed` by reading every markdown file once,
//   • forwards vault events (create/modify/delete/rename) to the engine.
//
// Everything app-specific lives here so `index.ts` stays unit-testable. Nothing
// in here has its own logic worth unit-testing — it's wiring — so it has no
// test; the engine it feeds is covered by `index.test.ts`.

import { TFile } from "obsidian";
import type { App, EventRef } from "obsidian";
import { KairosIndex } from "./index";
import type { IndexDeps, IndexPaths } from "./index";
import type Kairos from "./main";

export class IndexAdapter {
	readonly index: KairosIndex;
	private refs: EventRef[] = [];

	constructor(private plugin: Kairos) {
		this.index = new KairosIndex(this.buildDeps());
	}

	/** Cold start: seed from disk, then subscribe to vault changes. */
	async start(): Promise<void> {
		await this.seed();
		this.registerEvents();
	}

	/** Tear down: engine timers + our event refs. Vault refs are also owned by
	 *  the plugin via `registerEvent`, so this is belt-and-suspenders. */
	stop(): void {
		for (const ref of this.refs) this.plugin.app.vault.offref(ref);
		this.refs = [];
		this.index.dispose();
	}

	/**
	 * Re-read every file and rebuild the index from scratch. Used when a setting
	 * that changes how files are parsed — notably the schedule-section heading —
	 * has changed: days already in memory were parsed under the old heading and
	 * must be re-parsed. `index.seed` republishes to every subscribed store, so
	 * open views re-render with the freshly parsed data. Event subscriptions are
	 * untouched (they don't depend on the heading), so there's nothing to rewire.
	 */
	async reseed(): Promise<void> {
		await this.seed();
	}

	// ── dependency wiring ──

	private buildDeps(): IndexDeps {
		const app = this.plugin.app;
		const plugin = this.plugin;
		return {
			read: (path) => this.readPath(app, path),
			write: (path, content) => this.writePath(app, path, content),
			rename: (oldPath, newPath) => this.renamePath(app, oldPath, newPath),
			remove: (path) => this.removePath(app, path),
			now: () => Date.now(),
			// A getter so live settings edits are picked up without rebuilding.
			get settings(): IndexPaths {
				const s = plugin.settings;
				return {
					projectsFolder: s.projectsFolder,
					domainsFolder: s.domainsFolder,
					backlogPath: s.backlogPath,
					scheduleHeading: s.scheduleHeading,
				};
			},
			writeDebounceMs: 500,
		};
	}

	private async readPath(app: App, path: string): Promise<string> {
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) return app.vault.read(file);
		throw new Error(`Kairos: cannot read missing file ${path}`);
	}

	private async writePath(
		app: App,
		path: string,
		content: string,
	): Promise<void> {
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await app.vault.modify(file, content);
		} else {
			await app.vault.create(path, content);
		}
	}

	private async renamePath(
		app: App,
		oldPath: string,
		newPath: string,
	): Promise<void> {
		const file = app.vault.getAbstractFileByPath(oldPath);
		if (file instanceof TFile) await app.fileManager.renameFile(file, newPath);
	}

	private async removePath(app: App, path: string): Promise<void> {
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await app.vault.delete(file);
	}

	// ── cold start ──

	private async seed(): Promise<void> {
		const app = this.plugin.app;
		const files = app.vault.getMarkdownFiles();
		const seeded = await Promise.all(
			files.map(async (f) => ({
				path: f.path,
				content: await app.vault.read(f),
				mtime: f.stat.mtime,
			})),
		);
		this.index.seed(seeded);
	}

	// ── vault events ──

	private registerEvents(): void {
		const app = this.plugin.app;

		const onChange = (file: TFile) => {
			if (!(file instanceof TFile) || file.extension !== "md") return;
			void app.vault.read(file).then((content) => {
				this.index.onFileChanged(file.path, content, file.stat.mtime);
			});
		};

		this.track(app.vault.on("create", (f) => onChange(f as TFile)));
		this.track(app.vault.on("modify", (f) => onChange(f as TFile)));
		this.track(
			app.vault.on("delete", (f) => {
				if (f instanceof TFile) this.index.onFileDeleted(f.path);
			}),
		);
		this.track(
			app.vault.on("rename", (f, oldPath) => {
				// A rename changes the routing key: drop the old, index the new.
				this.index.onFileDeleted(oldPath);
				if (f instanceof TFile) onChange(f);
			}),
		);
	}

	private track(ref: EventRef): void {
		this.plugin.registerEvent(ref); // plugin owns cleanup on unload
		this.refs.push(ref);
	}
}
