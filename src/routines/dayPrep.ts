// Day preparation — the Obsidian glue that runs carry-over and routines.
//
// Every decision (carry or not, apply or not, which frontmatter keys change)
// lives in plan.ts and is unit-tested there. This module only decides WHEN to
// run, gathers the inputs, and persists the plan through the index's ordinary
// write path.
//
// Triggers:
//   • A daily note is created (by Kairos, the Daily Notes plugin, Templater, or
//     a sync). After a short delay — so a template finishes writing first — the
//     day is prepared once in `auto` mode: carry-over always, routines only
//     when "Add routines to new daily notes" is on (see plan.ts for the table).
//   • The "Apply routines to this day" command, in `manual` mode. "This day" is
//     the day the Day view shows when it is focused, else the open daily note,
//     else a day the user picks. It never silently creates a note the user
//     didn't choose.
//   • Opening a day whose recorded routines hash is out of date shows a notice
//     once.
//   • Saving the routines file reports any line Kairos can't use, so a typo in
//     a rule doesn't fail without a word.

import { MarkdownView, Notice, SuggestModal, TFile } from "obsidian";
import type { App } from "obsidian";
import { getDateFromPath } from "obsidian-daily-notes-interface";
import type Kairos from "../main";
import type { Block, ISODate } from "../types";
import { CARRIED_KEY, previousDay } from "../carry";
import { ensureNoteForDate, shiftISO, todayISO } from "../dayNote";
import { parseSchedule } from "../parser";
import { KairosView } from "../KairosView";
import { ROUTINES_KEY, applyRoutines, routinesFor, routinesStale } from "./apply";
import { activeRoutines, ownerActive, type OwnerActive } from "./owners";
import { parseRoutines, type ParsedRoutines, type Routine } from "./routinesFile";
import { dayLabel as label, manualMessage, planDayPrep, type PrepMode, type PrepPlan } from "./plan";

/** How long to let a template or sync finish writing a new note. */
const SETTLE_MS = 1500;
/** How long to wait after the routines file stops changing before checking it. */
const CHECK_MS = 1000;

export class DayPreparer {
	private inFlight = new Set<ISODate>();
	private warnedStale = new Set<ISODate>();
	private timers = new Set<number>();
	private checkTimer: number | undefined;
	private lastProblems = "";

	constructor(private plugin: Kairos) {}

	/** Subscribe to vault and workspace events. Call once the index is seeded. */
	start(): void {
		const { app } = this.plugin;
		this.plugin.register(() => {
			for (const t of this.timers) window.clearTimeout(t);
			this.timers.clear();
			if (this.checkTimer !== undefined) window.clearTimeout(this.checkTimer);
		});
		this.plugin.registerEvent(
			app.vault.on("create", (file) => {
				if (!(file instanceof TFile)) return;
				const date = dateOf(file);
				if (!date || date < todayISO()) return;
				const timer = window.setTimeout(() => {
					this.timers.delete(timer);
					void this.prepare(file, date, "auto");
				}, SETTLE_MS);
				this.timers.add(timer);
			}),
		);
		this.plugin.registerEvent(
			app.workspace.on("file-open", (file) => {
				if (file) void this.warnIfStale(file);
			}),
		);
		this.plugin.registerEvent(
			app.vault.on("modify", (file) => {
				if (file.path !== this.plugin.settings.routinesPath) return;
				if (this.checkTimer !== undefined) window.clearTimeout(this.checkTimer);
				this.checkTimer = window.setTimeout(() => {
					this.checkTimer = undefined;
					void this.reportProblems();
				}, CHECK_MS);
			}),
		);
	}

	/** The command: re-apply routines to the day in front of the user. */
	async applyToCurrentDay(): Promise<void> {
		const date = this.focusedDate() ?? (await this.pickDate());
		if (date) await this.applyToDate(date);
	}

	/**
	 * Apply every routine due on `date` (creating its note if needed), record
	 * the hash, and say what happened. Shared by the command and the Grid's
	 * "Add routines" button.
	 */
	async applyToDate(date: ISODate): Promise<void> {
		const file = await this.noteFor(date);
		if (!file) return;
		const parsed = await this.loadRoutines();
		const plan = await this.prepare(file, date, "manual", parsed);
		if (!plan) return; // already being prepared
		new Notice(manualMessage(plan, date, parsed, this.plugin.settings.routinesPath));
	}

	/**
	 * Add some routines to `date` (creating its note if needed): one item from a
	 * routines alert, a block with its tasks or a single task. Doesn't record the
	 * hash — pulling in part of a day's routines doesn't mark it as set up.
	 * Additive like every apply: what's already in the day adds nothing.
	 */
	async insertRoutines(date: ISODate, routines: Routine[]): Promise<void> {
		const file = await this.noteFor(date);
		if (!file) return;
		const blocks = await this.currentBlocks(file, date);
		const r = applyRoutines(blocks, routines, date, file.path);
		if (r.added > 0) this.plugin.indexAdapter.index.applyDayEdit(date, file.path, r.blocks);
	}

	/** The daily note for `date`, created if missing; null (with a notice) on failure. */
	private async noteFor(date: ISODate): Promise<TFile | null> {
		try {
			const path = await ensureNoteForDate(date);
			const found = this.plugin.app.vault.getAbstractFileByPath(path);
			if (found instanceof TFile) return found;
		} catch {
			// fall through to the notice
		}
		new Notice(`Kairos couldn't open the daily note for ${label(date)}.`);
		return null;
	}

	/** The day's blocks: the index's copy if it has one, else the file's. */
	private async currentBlocks(file: TFile, date: ISODate): Promise<Block[]> {
		const day = this.plugin.indexAdapter.index.snapshot().days.get(date);
		if (day && day.path === file.path) return day.blocks;
		const text = await this.plugin.app.vault.read(file);
		return parseSchedule(text, file.path, this.plugin.settings.scheduleHeading);
	}

	/**
	 * The date the user is looking at: the Day view's date when it is the
	 * active view, else the date of the daily note open in the active editor.
	 * Anything else (the Week view, the routines file itself) → undefined, and
	 * the command asks rather than guessing.
	 */
	private focusedDate(): ISODate | undefined {
		const { workspace } = this.plugin.app;
		const dayView = workspace.getActiveViewOfType(KairosView);
		if (dayView?.date) return dayView.date;
		const file = workspace.getActiveViewOfType(MarkdownView)?.file;
		return file ? dateOf(file) : undefined;
	}

	private async pickDate(): Promise<ISODate | undefined> {
		const routines = (await this.loadRoutines()).routines;
		return new Promise((resolve) => {
			new DatePickModal(this.plugin.app, (date) => {
				const due = activeRoutines(routinesFor(routines, date), date, this.ownerActive()).length;
				return due === 0 ? "No routines due" : `${due} routine${due === 1 ? "" : "s"} due`;
			}, resolve).open();
		});
	}

	private async prepare(
		file: TFile,
		date: ISODate,
		mode: PrepMode,
		parsed?: ParsedRoutines,
	): Promise<PrepPlan | undefined> {
		if (this.inFlight.has(date)) return undefined;
		this.inFlight.add(date);
		try {
			return await this.prepareNow(file, date, mode, parsed ?? (await this.loadRoutines()));
		} finally {
			this.inFlight.delete(date);
		}
	}

	private async prepareNow(
		file: TFile,
		date: ISODate,
		mode: PrepMode,
		parsed: ParsedRoutines,
	): Promise<PrepPlan> {
		const { app } = this.plugin;
		const index = this.plugin.indexAdapter.index;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const days = index.snapshot().days;
		const blocks = await this.currentBlocks(file, date);
		const recorded = readKey(fm[ROUTINES_KEY]);
		const prev = previousDay(days, date);

		const plan = planDayPrep({
			mode,
			date,
			today: todayISO(),
			path: file.path,
			blocks,
			...(recorded !== undefined ? { recorded } : {}),
			carried: fm[CARRIED_KEY] !== undefined,
			...(prev ? { previous: { date: prev.date, path: prev.path, blocks: prev.blocks } } : {}),
			routines: parsed.routines,
			active: this.ownerActive(),
			autoApply: this.plugin.settings.autoApplyRoutines,
		});

		if (plan.outcome === "stale") this.noticeStale(date);

		// Frontmatter first, so the debounced schedule write that follows splices
		// into a file that already carries the keys.
		const keys = Object.entries(plan.frontmatter);
		if (keys.length > 0) {
			await app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
				for (const [key, value] of keys) {
					if (value === null) delete front[key];
					else front[key] = value;
				}
			});
		}

		if (plan.previous) {
			index.applyCrossDayMove(
				plan.previous.date,
				plan.previous.path,
				plan.previous.blocks,
				date,
				file.path,
				plan.blocks,
			);
		} else if (plan.added > 0) {
			index.applyDayEdit(date, file.path, plan.blocks);
		}
		return plan;
	}

	/** Whether a routine's project or domain is active on a date, from the index. */
	private ownerActive(): OwnerActive {
		const { projects, domains } = this.plugin.indexAdapter.index.snapshot();
		return ownerActive(projects, domains);
	}

	private async loadRoutines(): Promise<ParsedRoutines> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.plugin.settings.routinesPath);
		if (!(file instanceof TFile)) return { routines: [], problems: [] };
		return parseRoutines(await this.plugin.app.vault.read(file));
	}

	/** After the routines file is saved: say once which lines Kairos can't use. */
	private async reportProblems(): Promise<void> {
		const { problems } = await this.loadRoutines();
		const summary = problems.map((p) => `Line ${p.line + 1}: ${p.message}`).join("\n");
		if (summary === this.lastProblems) return;
		this.lastProblems = summary;
		if (summary) {
			new Notice(`${this.plugin.settings.routinesPath} has lines Kairos can't use:\n${summary}`, 10000);
		}
	}

	private async warnIfStale(file: TFile): Promise<void> {
		const date = dateOf(file);
		if (!date || date < todayISO() || this.warnedStale.has(date)) return;
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		const recorded = readKey(fm?.[ROUTINES_KEY]);
		if (recorded === undefined) return;
		const routines = activeRoutines((await this.loadRoutines()).routines, date, this.ownerActive());
		if (routinesStale(recorded, routines, date)) {
			this.noticeStale(date);
		}
	}

	private noticeStale(date: ISODate): void {
		if (this.warnedStale.has(date)) return;
		this.warnedStale.add(date);
		new Notice(
			`Your routines for ${label(date)} changed since that day was set up. Run "Apply routines to this day" to add the new ones.`,
		);
	}
}

/** The ISO date of a daily note, or undefined for any other file. */
function dateOf(file: TFile): ISODate | undefined {
	if (file.extension !== "md") return undefined;
	const m = getDateFromPath(file.path, "day");
	return m ? m.format("YYYY-MM-DD") : undefined;
}

/** A frontmatter value as a string key, or undefined when absent. */
function readKey(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	// YAML may read an all-digit hash as a number.
	if (typeof value === "number") return String(value);
	return undefined;
}

/** Pick a day: yesterday through a week ahead, each with its routine count. */
class DatePickModal extends SuggestModal<ISODate> {
	private chosen = false;

	constructor(
		app: App,
		private describe: (date: ISODate) => string,
		private done: (date: ISODate | undefined) => void,
	) {
		super(app);
		this.setPlaceholder("Apply routines to which day?");
	}

	getSuggestions(query: string): ISODate[] {
		const today = todayISO();
		const days = Array.from({ length: 9 }, (_, i) => shiftISO(today, i - 1));
		const q = query.trim().toLowerCase();
		return q ? days.filter((d) => this.text(d).toLowerCase().includes(q)) : days;
	}

	renderSuggestion(date: ISODate, el: HTMLElement): void {
		el.createDiv({ text: this.text(date) });
		el.createEl("small", { text: this.describe(date) });
	}

	onChooseSuggestion(date: ISODate): void {
		this.chosen = true;
		this.done(date);
	}

	onClose(): void {
		// onChooseSuggestion fires after onClose; defer so a choice wins.
		window.setTimeout(() => {
			if (!this.chosen) this.done(undefined);
		}, 0);
	}

	private text(date: ISODate): string {
		const today = todayISO();
		const rel =
			date === today ? " (today)" : date === shiftISO(today, 1) ? " (tomorrow)" : date === shiftISO(today, -1) ? " (yesterday)" : "";
		return `${label(date)}${rel}`;
	}
}
