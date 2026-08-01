import { MarkdownView, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { writable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { DEFAULT_SETTINGS, KairosSettingTab } from './settings';
import type { KairosSettings } from './settings';
import { parseSchedule } from './parser';
import { resolveBlocks } from './resolver';
import type { ISODate } from './types';
import { KAIROS_VIEW_TYPE, KairosView } from './KairosView';
import { KAIROS_WEEK_VIEW_TYPE, KairosWeekView } from './KairosWeekView';
import { IndexAdapter } from './indexAdapter';

// Derive an ISO date from a daily-note basename (YYYY-MM-DD), falling back to
// the basename itself when it doesn't look like a date.
function dateFromBasename(basename: string): ISODate {
	const m = /(\d{4}-\d{2}-\d{2})/.exec(basename);
	return m?.[1] ?? basename;
}

export default class Kairos extends Plugin {
	/**
	 * The canonical settings object. Synchronous, non-UI code (the index, path
	 * helpers, layout math) reads this directly. It is also what gets persisted.
	 * The UI must NOT read this for reactivity — it reads `settings$` instead, so
	 * a change reaches every open view (and the settings tab) live. `updateSettings`
	 * is the one write path that keeps the two in sync.
	 */
	settings!: KairosSettings;
	/**
	 * Reactive mirror of `settings` for the UI. Every write goes through
	 * `updateSettings`, which mutates `settings`, persists, and republishes here,
	 * so all subscribed views re-derive at once — regardless of which view or the
	 * settings tab made the change.
	 */
	settings$!: Readable<KairosSettings>;
	private setSettings!: (s: KairosSettings) => void;
	/** The live index. Views read from `plugin.index.index`. */
	indexAdapter!: IndexAdapter;

	async onload() {
		await this.loadSettings();

		// Build the index now; cold-start it once the vault is fully loaded so
		// the seed sees every file (and doesn't race Obsidian's own indexing).
		this.indexAdapter = new IndexAdapter(this);
		this.app.workspace.onLayoutReady(() => {
			void this.indexAdapter.start();
		});

		this.registerView(
			KAIROS_VIEW_TYPE,
			(leaf) => new KairosView(leaf, this),
		);

		this.registerView(
			KAIROS_WEEK_VIEW_TYPE,
			(leaf) => new KairosWeekView(leaf, this),
		);

		this.addRibbonIcon('clock', 'Open Kairos Day view', () => {
			void this.activateView();
		});

		this.addRibbonIcon('calendar-range', 'Open Kairos Week view', () => {
			void this.activateWeekView();
		});

		this.addCommand({
			id: 'open-kairos-day-view',
			name: 'Open Day view',
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: 'open-kairos-week-view',
			name: 'Open Week view',
			callback: () => void this.activateWeekView(),
		});

		// Dev command: parse the active note's Schedule section and log the JSON.
		this.addCommand({
			id: 'test-parse-active-file',
			name: 'Test: parse active file schedule',
			checkCallback: (checking: boolean) => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				const file = view?.file;
				if (!file) return false;

				if (!checking) void this.testParse();
				return true;
			},
		});

		// Dev command: parse the active note's Schedule section and log the JSON.
		this.addCommand({
			id: 'test-parse-and-resolve-active-file',
			name: 'Test: parse and resolve active file schedule',
			checkCallback: (checking: boolean) => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				const file = view?.file;
				if (!file) return false;

				if (!checking) void this.testParseAndResolve();
				return true;
			},
		});

		this.addSettingTab(new KairosSettingTab(this.app, this));
	}

	onunload() {
		this.indexAdapter?.stop();
	}

	// Reveal the Kairos view, reusing an existing leaf if one is already open.
	async activateView() {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(KAIROS_VIEW_TYPE);
		let leaf: WorkspaceLeaf | null =
			existing.length > 0 ? existing[0] ?? null : null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: KAIROS_VIEW_TYPE, active: true });
		}

		if (leaf) void workspace.revealLeaf(leaf);
	}

	// Reveal the Week view in a main (center) leaf, reusing one if already open.
	async activateWeekView() {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(KAIROS_WEEK_VIEW_TYPE);
		let leaf: WorkspaceLeaf | null =
			existing.length > 0 ? existing[0] ?? null : null;

		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({
				type: KAIROS_WEEK_VIEW_TYPE,
				active: true,
			});
		}

		if (leaf) void workspace.revealLeaf(leaf);
	}

	private async testParse() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('Kairos: no active file');
			return;
		}

		const markdown = await this.app.vault.read(file);
		const blocks = parseSchedule(markdown, file.path);

		console.log(`[Kairos] parsed ${blocks.length} block(s) from ${file.path}`);
		console.log(JSON.stringify(blocks, null, 2));
		new Notice(`Kairos: parsed ${blocks.length} block(s) — see console`);
	}

	private async testParseAndResolve() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('Kairos: no active file');
			return;
		}

		const markdown = await this.app.vault.read(file);
		const blocks = parseSchedule(markdown, file.path);

		console.log(`[Kairos] parsed ${blocks.length} block(s) from ${file.path}`);
		console.log(JSON.stringify(blocks, null, 2));
		new Notice(`Kairos: parsed ${blocks.length} block(s) — see console`);

		const tasks = resolveBlocks(blocks, dateFromBasename(file.basename));
		console.log(`[Kairos] resolve ${blocks.length} blocks(s) from ${file.path}`)
		console.log(JSON.stringify(tasks, null, 2))
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<KairosSettings>,
		);
		const store = writable(this.settings);
		this.settings$ = { subscribe: store.subscribe };
		this.setSettings = store.set;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Republish so subscribed UI re-derives. A fresh object identity guarantees
		// the store notifies even though `settings` was mutated in place.
		this.setSettings({ ...this.settings });
	}

	/**
	 * The one write path for settings from the UI. Mutate the canonical object in
	 * `mutate`, then persist + republish so every subscriber updates live. Prefer
	 * this over touching `settings` directly followed by `saveSettings`.
	 */
	async updateSettings(mutate: (s: KairosSettings) => void) {
		mutate(this.settings);
		await this.saveSettings();
	}
}
