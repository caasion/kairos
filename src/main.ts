import { Plugin, WorkspaceLeaf } from 'obsidian';
import { writable } from 'svelte/store';
import type { Readable, Writable } from 'svelte/store';
import { DEFAULT_SETTINGS, KairosSettingTab } from './settings';
import type { KairosSettings } from './settings';
import type { ISODate } from './types';
import { KAIROS_VIEW_TYPE, KairosView } from './KairosView';
import { KAIROS_WEEK_VIEW_TYPE, KairosWeekView } from './KairosWeekView';
import { KAIROS_GRID_VIEW_TYPE, KairosGridView } from './KairosGridView';
import {
	KAIROS_BACKLOG_VIEW_TYPE,
	KairosBacklogView,
} from './KairosBacklogView';
import {
	KAIROS_PROJECTS_VIEW_TYPE,
	KairosProjectsView,
} from './KairosProjectsView';
import { KAIROS_GANTT_VIEW_TYPE, KairosGanttView } from './KairosGanttView';
import { IndexAdapter } from './indexAdapter';

/**
 * A request to reveal a specific block in the Day view. Pushed by the Grid view
 * when a scheduled task's block badge is clicked; consumed by the Day view,
 * which navigates to `date` and scrolls the block (identified by its source
 * `line`) into view. `nonce` makes two requests for the same target distinct,
 * so a repeat click still notifies subscribers.
 */
export interface RevealRequest {
	date: ISODate;
	blockLine: number;
	nonce: number;
}

/**
 * A filtered-backlog request from the Projects & Domains page. `names` is the
 * allow-list of association names an entry may carry to be shown (the domain
 * plus its child projects for a domain button; just the project for a project
 * button — spec §5, settled rule). `label` names the filter for the header
 * ("Health", "Learn Spanish"). `nonce` makes repeat clicks distinct.
 */
export interface BacklogFilter {
	names: string[];
	label: string;
	nonce: number;
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
	/**
	 * Cross-view reveal channel. The Grid pushes a `RevealRequest` here (via
	 * `revealInDayView`); the Day view subscribes and jumps + scrolls to the
	 * block. A store keeps the two leaves decoupled — the Grid never holds a
	 * handle to the Day view instance.
	 */
	reveal$!: Readable<RevealRequest | null>;
	private pushReveal!: (r: RevealRequest | null) => void;
	private revealNonce = 0;

	/**
	 * Backlog filter channel. The Projects & Domains page pushes an allow-list of
	 * association names here (a domain + its child projects, or one project) and
	 * opens the Backlog view; the Backlog view subscribes and shows only matching
	 * entries. `null` means "no filter — show everything" (the normal open path).
	 * A store keeps the two leaves decoupled, exactly like `reveal$`.
	 */
	backlogFilter$!: Readable<BacklogFilter | null>;
	private pushBacklogFilter!: (f: BacklogFilter | null) => void;

	async onload() {
		await this.loadSettings();

		// The cross-view reveal channel (Grid badge → Day view jump/scroll).
		const revealStore: Writable<RevealRequest | null> = writable(null);
		this.reveal$ = { subscribe: revealStore.subscribe };
		this.pushReveal = revealStore.set;

		// The backlog-filter channel (Projects page → filtered Backlog view).
		const filterStore: Writable<BacklogFilter | null> = writable(null);
		this.backlogFilter$ = { subscribe: filterStore.subscribe };
		this.pushBacklogFilter = filterStore.set;

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

		this.registerView(
			KAIROS_GRID_VIEW_TYPE,
			(leaf) => new KairosGridView(leaf, this),
		);

		this.registerView(
			KAIROS_BACKLOG_VIEW_TYPE,
			(leaf) => new KairosBacklogView(leaf, this),
		);

		this.registerView(
			KAIROS_PROJECTS_VIEW_TYPE,
			(leaf) => new KairosProjectsView(leaf, this),
		);

		this.registerView(
			KAIROS_GANTT_VIEW_TYPE,
			(leaf) => new KairosGanttView(leaf, this),
		);

		this.addRibbonIcon('clock', 'Open Kairos day view', () => {
			void this.activateView();
		});

		this.addRibbonIcon('calendar-range', 'Open Kairos week view', () => {
			void this.activateWeekView();
		});

		this.addRibbonIcon('layout-grid', 'Open Kairos grid view', () => {
			void this.activateGridView();
		});

		this.addRibbonIcon('inbox', 'Open Kairos backlog view', () => {
			void this.activateBacklogView();
		});

		this.addRibbonIcon('folder-kanban', 'Open Kairos projects view', () => {
			void this.activateProjectsView();
		});

		this.addRibbonIcon('gantt-chart', 'Open Kairos timeline view', () => {
			void this.activateGanttView();
		});

		this.addCommand({
			id: 'open-day-view',
			name: 'Open day view',
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: 'open-week-view',
			name: 'Open week view',
			callback: () => void this.activateWeekView(),
		});

		this.addCommand({
			id: 'open-grid-view',
			name: 'Open grid view',
			callback: () => void this.activateGridView(),
		});

		this.addCommand({
			id: 'open-backlog-view',
			name: 'Open backlog view',
			callback: () => void this.activateBacklogView(),
		});

		this.addCommand({
			id: 'open-projects-view',
			name: 'Open projects & domains view',
			callback: () => void this.activateProjectsView(),
		});

		this.addCommand({
			id: 'open-gantt-view',
			name: 'Open timeline view',
			callback: () => void this.activateGanttView(),
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

	/**
	 * Open the Day view and ask it to reveal a block — the Grid's block badge
	 * click lands here. Activating the view first guarantees a subscriber exists;
	 * the request is pushed after so a freshly-opened Day view (which subscribes
	 * on mount) still receives it.
	 */
	async revealInDayView(date: ISODate, blockLine: number) {
		await this.activateView();
		this.pushReveal({ date, blockLine, nonce: ++this.revealNonce });
	}

	// Reveal the Grid view in a main (center) leaf, reusing one if already open.
	async activateGridView() {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(KAIROS_GRID_VIEW_TYPE);
		let leaf: WorkspaceLeaf | null =
			existing.length > 0 ? existing[0] ?? null : null;

		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({
				type: KAIROS_GRID_VIEW_TYPE,
				active: true,
			});
		}

		if (leaf) void workspace.revealLeaf(leaf);
	}

	// Reveal the Backlog view in the right sidebar, reusing a leaf if one is open.
	// `clearFilter` (the default) resets any project/domain filter so a plain open
	// from the ribbon/command shows the whole backlog; `openBacklogFiltered` opens
	// without clearing, then pushes its own filter.
	async activateBacklogView(clearFilter = true) {
		if (clearFilter) this.pushBacklogFilter(null);
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(KAIROS_BACKLOG_VIEW_TYPE);
		let leaf: WorkspaceLeaf | null =
			existing.length > 0 ? existing[0] ?? null : null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({
				type: KAIROS_BACKLOG_VIEW_TYPE,
				active: true,
			});
		}

		if (leaf) void workspace.revealLeaf(leaf);
	}

	// Reveal the Projects & Domains view in a main (center) leaf, reusing one.
	async activateProjectsView() {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(KAIROS_PROJECTS_VIEW_TYPE);
		let leaf: WorkspaceLeaf | null =
			existing.length > 0 ? existing[0] ?? null : null;

		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({
				type: KAIROS_PROJECTS_VIEW_TYPE,
				active: true,
			});
		}

		if (leaf) void workspace.revealLeaf(leaf);
	}

	// Reveal the Timeline view in a main (center) leaf, reusing one.
	async activateGanttView() {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(KAIROS_GANTT_VIEW_TYPE);
		let leaf: WorkspaceLeaf | null =
			existing.length > 0 ? existing[0] ?? null : null;

		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({
				type: KAIROS_GANTT_VIEW_TYPE,
				active: true,
			});
		}

		if (leaf) void workspace.revealLeaf(leaf);
	}

	/**
	 * Open the Backlog view filtered to a set of association names — the Projects
	 * page's "view backlog" button lands here. Activating first guarantees a
	 * subscriber exists; the filter is pushed after so a freshly-opened Backlog
	 * view (which subscribes on mount) still receives it. Passing `null` clears
	 * any prior filter, so a plain Backlog open always shows everything.
	 */
	async openBacklogFiltered(names: string[], label: string) {
		await this.activateBacklogView(false);
		this.pushBacklogFilter({ names, label, nonce: ++this.revealNonce });
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
