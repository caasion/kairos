// Day preparation — the Obsidian glue that runs carry-over and routines.
//
// The pure work lives in carry.ts and routines/apply.ts; this module decides
// WHEN it runs and persists the result through the index's ordinary write path.
//
// Trigger: a daily note is created (by Kairos's own `ensureNoteForDate`, the
// Daily Notes plugin, Templater, or a sync). After a short delay — so a
// template finishes writing first — Kairos prepares that day once:
//   • carry-over, only when the new note is TODAY's: open and half-done tasks
//     move in from the most recent earlier note. Planning a future day never
//     pulls today's work forward. Recorded as `kairos-carried: <from date>`.
//   • routines, for today or a future day, only when the note has no
//     `kairos-routines` key yet. The key records a hash of the routines due
//     that day. If it is already there, the day was set up before (perhaps on
//     another device), so nothing is re-added — that is what protects lines the
//     user deliberately deleted.
// Past days are never touched.
//
// The "Apply routines to this day" command re-applies on demand (additive and
// idempotent; it never removes lines) and records the new hash. When an open
// day's recorded hash no longer matches its routines, a notice says so once.

import { Notice, TFile } from "obsidian";
import { getDateFromPath } from "obsidian-daily-notes-interface";
import type Kairos from "../main";
import type { Block, ISODate } from "../types";
import { CARRIED_KEY, carryOver, previousDay } from "../carry";
import { ensureNoteForDate, todayISO } from "../dayNote";
import { parseSchedule } from "../parser";
import { ROUTINES_KEY, applyRoutines, routinesHash, routinesStale } from "./apply";
import { parseRoutines, type Routine } from "./routinesFile";

/** How long to let a template or sync finish writing a new note. */
const SETTLE_MS = 1500;

export class DayPreparer {
	private inFlight = new Set<ISODate>();
	private warnedStale = new Set<ISODate>();
	private timers = new Set<number>();

	constructor(private plugin: Kairos) {}

	/** Subscribe to vault and workspace events. Call once the index is seeded. */
	start(): void {
		const { app } = this.plugin;
		this.plugin.register(() => {
			for (const t of this.timers) window.clearTimeout(t);
			this.timers.clear();
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
	}

	/** The command: re-apply routines to the active daily note, or today's. */
	async applyToActiveDay(): Promise<void> {
		const { app } = this.plugin;
		const active = app.workspace.getActiveFile();
		let file = active && dateOf(active) ? active : null;
		if (!file) {
			const path = await ensureNoteForDate(todayISO());
			const found = app.vault.getAbstractFileByPath(path);
			file = found instanceof TFile ? found : null;
		}
		const date = file ? dateOf(file) : undefined;
		if (!file || !date) {
			new Notice("Kairos: open a daily note first.");
			return;
		}
		const added = await this.prepare(file, date, "manual");
		new Notice(
			added === 0
				? "Routines are already in this day."
				: `Added ${added} item${added === 1 ? "" : "s"} from routines.`,
		);
	}

	/**
	 * Prepare one day. `auto` carries (today only) and applies routines only on
	 * a day that hasn't recorded them; `manual` re-applies routines regardless.
	 * Returns how many routine items were added.
	 */
	private async prepare(
		file: TFile,
		date: ISODate,
		mode: "auto" | "manual",
	): Promise<number> {
		if (this.inFlight.has(date)) return 0;
		this.inFlight.add(date);
		try {
			return await this.prepareNow(file, date, mode);
		} finally {
			this.inFlight.delete(date);
		}
	}

	private async prepareNow(
		file: TFile,
		date: ISODate,
		mode: "auto" | "manual",
	): Promise<number> {
		const { app } = this.plugin;
		const index = this.plugin.indexAdapter.index;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const recorded = readKey(fm[ROUTINES_KEY]);

		let blocks = await this.currentBlocks(file, date);
		const frontmatter: Record<string, string | null> = {};

		// Carry-over: today's note only, once.
		let carriedFrom: { date: ISODate; path: string; blocks: Block[] } | undefined;
		if (mode === "auto" && date === todayISO() && fm[CARRIED_KEY] === undefined) {
			const prev = previousDay(index.snapshot().days, date);
			if (prev) {
				const r = carryOver(prev.blocks, blocks, file.path);
				if (r.moved > 0) {
					blocks = r.to;
					carriedFrom = { date: prev.date, path: prev.path, blocks: r.from };
					frontmatter[CARRIED_KEY] = prev.date;
				}
			}
		}

		// Routines.
		let added = 0;
		const routines = await this.loadRoutines();
		const hash = routinesHash(routines, date);
		const shouldApply = mode === "manual" || recorded === undefined;
		if (shouldApply) {
			const r = applyRoutines(blocks, routines, date, file.path);
			blocks = r.blocks;
			added = r.added;
			if (hash !== "" && hash !== recorded) frontmatter[ROUTINES_KEY] = hash;
			if (hash === "" && recorded !== undefined) frontmatter[ROUTINES_KEY] = null;
		} else if (routinesStale(recorded, routines, date)) {
			this.noticeStale(date);
		}

		if (Object.keys(frontmatter).length === 0 && !carriedFrom && added === 0) {
			return 0;
		}

		// Frontmatter first, so the debounced schedule write that follows splices
		// into a file that already carries the keys.
		if (Object.keys(frontmatter).length > 0) {
			await app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
				for (const [key, value] of Object.entries(frontmatter)) {
					if (value === null) delete front[key];
					else front[key] = value;
				}
			});
		}

		if (carriedFrom) {
			index.applyCrossDayMove(
				carriedFrom.date,
				carriedFrom.path,
				carriedFrom.blocks,
				date,
				file.path,
				blocks,
			);
		} else if (added > 0) {
			index.applyDayEdit(date, file.path, blocks);
		}
		return added;
	}

	/** The day's blocks: the index's copy if it has one, else the file's. */
	private async currentBlocks(file: TFile, date: ISODate): Promise<Block[]> {
		const day = this.plugin.indexAdapter.index.snapshot().days.get(date);
		if (day && day.path === file.path) return day.blocks;
		const text = await this.plugin.app.vault.read(file);
		return parseSchedule(text, file.path, this.plugin.settings.scheduleHeading);
	}

	private async loadRoutines(): Promise<Routine[]> {
		const file = this.plugin.app.vault.getAbstractFileByPath(
			this.plugin.settings.routinesPath,
		);
		if (!(file instanceof TFile)) return [];
		return parseRoutines(await this.plugin.app.vault.read(file)).routines;
	}

	private async warnIfStale(file: TFile): Promise<void> {
		const date = dateOf(file);
		if (!date || date < todayISO() || this.warnedStale.has(date)) return;
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		const recorded = readKey(fm?.[ROUTINES_KEY]);
		if (recorded === undefined) return;
		if (routinesStale(recorded, await this.loadRoutines(), date)) {
			this.noticeStale(date);
		}
	}

	private noticeStale(date: ISODate): void {
		if (this.warnedStale.has(date)) return;
		this.warnedStale.add(date);
		new Notice(
			`Your routines for ${date} changed since this day was set up. Run "Apply routines to this day" to add the new ones.`,
		);
	}
}

/** The ISO date of a daily note, or undefined for any other file. */
function dateOf(file: TFile): ISODate | undefined {
	if (file.extension !== "md") return undefined;
	const m = getDateFromPath(file.path, "day");
	return m ? m.format("YYYY-MM-DD") : undefined;
}

/** A frontmatter value as a string key (YAML may read a numeric hash as a number). */
function readKey(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}
