// The routines feed — one plugin-level source of routines for every view.
//
// Views subscribe here instead of each reading the routines file:
//   • `routines$` yields the parsed routines file, straight from the
//     RoutinesStore (which owns reading, watching and writing the file).
//   • `marks$` yields a lookup from a date to the `kairos-routines` hash its
//     daily note records, or undefined. It republishes (debounced) whenever a
//     daily note's metadata changes or a note is deleted, so a view re-derives
//     its routine previews the moment a day is set up.
// Obsidian glue only; the decisions live in preview.ts and plan.ts.

import { TFile, moment } from "obsidian";
import type { TAbstractFile } from "obsidian";
import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { getAllDailyNotes, getDailyNote, getDateFromPath } from "obsidian-daily-notes-interface";
import type Kairos from "../main";
import type { ISODate } from "../types";
import { ROUTINES_KEY } from "./apply";
import type { ParsedRoutines } from "./routinesFile";
import type { RoutinesStore } from "./routinesStore";

/** The recorded routines hash for a date, or undefined. */
export type RoutineMarks = (date: ISODate) => string | undefined;

const DEBOUNCE_MS = 250;

export class RoutinesFeed {
	private marksStore = writable<RoutineMarks>(() => undefined);
	private marksTimer: number | undefined;

	/** The parsed routines file — the RoutinesStore's copy, shared, not re-read. */
	readonly routines$: Readable<ParsedRoutines>;
	readonly marks$: Readable<RoutineMarks> = { subscribe: this.marksStore.subscribe };

	constructor(
		private plugin: Kairos,
		routines: RoutinesStore,
	) {
		this.routines$ = routines.parsed$;
	}

	/** Subscribe to daily-note metadata events. Call when the layout is ready. */
	start(): void {
		const { app } = this.plugin;
		this.plugin.register(() => {
			if (this.marksTimer !== undefined) window.clearTimeout(this.marksTimer);
		});
		this.plugin.registerEvent(
			app.vault.on("delete", (f) => {
				if (isDailyNote(f)) this.scheduleMarks();
			}),
		);
		this.plugin.registerEvent(
			app.metadataCache.on("changed", (file) => {
				if (isDailyNote(file)) this.scheduleMarks();
			}),
		);
		this.publishMarks();
	}

	private scheduleMarks(): void {
		if (this.marksTimer !== undefined) window.clearTimeout(this.marksTimer);
		this.marksTimer = window.setTimeout(() => {
			this.marksTimer = undefined;
			this.publishMarks();
		}, DEBOUNCE_MS);
	}

	/** Publish a fresh lookup, so subscribers re-derive. Reads lazily per date. */
	private publishMarks(): void {
		const { metadataCache } = this.plugin.app;
		// Each published lookup scans the daily notes at most once, and answers
		// each date at most once, however often a view re-renders.
		let all: ReturnType<typeof getAllDailyNotes> | undefined;
		const memo = new Map<ISODate, string | undefined>();
		const read = (date: ISODate): string | undefined => {
			let note: TFile | null = null;
			try {
				all ??= getAllDailyNotes();
				note = getDailyNote(moment(date, "YYYY-MM-DD"), all);
			} catch {
				return undefined;
			}
			if (!note) return undefined;
			const value: unknown = metadataCache.getFileCache(note)?.frontmatter?.[ROUTINES_KEY];
			if (typeof value === "string") return value;
			if (typeof value === "number") return String(value);
			return undefined;
		};
		this.marksStore.set((date) => {
			if (!memo.has(date)) memo.set(date, read(date));
			return memo.get(date);
		});
	}
}

function isDailyNote(file: TAbstractFile): boolean {
	return file instanceof TFile && file.extension === "md" && getDateFromPath(file.path, "day") !== null;
}
