// Gantt/strength view: derive renderable spans from a status history.
//
// The history array is the single temporal record; there is no stored "span".
// Each record opens a span that runs until the next record's date (the last span
// is open-ended, rendered as running to `today`). This module is pure and
// vault-free so it runs under vitest, mirroring projectFile.ts.
//
// A span's `note` (the freeform open-label annotation, e.g. baseline/hard/taper)
// drives *intensity* shading — never logic. `noteToIntensity` maps a note to a
// 0..1 ramp with a sensible default, so an unknown note still renders.

import type { ISODate, LifecycleState, StatusRecord } from "../types";

export interface Span {
	start: ISODate;
	/** Exclusive-ish end used for rendering; the open last span ends at `today`. */
	end: ISODate;
	status: LifecycleState;
	note?: string;
	/** True for the trailing, still-running span (no successor record). */
	open: boolean;
	/** 0..1 shading intensity derived from the note (active spans only). */
	intensity: number;
}

/**
 * Map a freeform note to a 0..1 intensity for shading. Deliberately small and
 * replaceable — the open-label principle means notes are user text, so anything
 * unrecognised falls back to `DEFAULT_INTENSITY` rather than being treated as an
 * error. Matching is case-insensitive and trims.
 */
const INTENSITY_RAMP: Record<string, number> = {
	taper: 0.35,
	baseline: 0.55,
	hard: 1,
};
const DEFAULT_INTENSITY = 0.7;

export function noteToIntensity(note: string | undefined): number {
	if (!note) return DEFAULT_INTENSITY;
	const key = note.trim().toLowerCase();
	return INTENSITY_RAMP[key] ?? DEFAULT_INTENSITY;
}

/**
 * Fold an ordered status history into renderable spans. Assumes `history` is
 * already normalized (sorted, one-per-date) as projectFile guarantees, but does
 * not depend on it. Returns `[]` for an empty history (the entity defaults to
 * active with no recorded transitions — nothing to draw retrospectively).
 *
 * `today` bounds the open trailing span. A record dated in the future still
 * opens a span starting at that date; when the newest record is in the future,
 * the trailing span may start after `today` and its `end` is clamped to `start`.
 */
export function historyToSpans(
	history: StatusRecord[],
	today: ISODate,
): Span[] {
	if (history.length === 0) return [];

	const sorted = [...history].sort((a, b) =>
		a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
	);

	const spans: Span[] = [];
	for (let i = 0; i < sorted.length; i++) {
		const rec = sorted[i]!;
		const next = sorted[i + 1];
		const open = next === undefined;
		const rawEnd = open ? today : next!.date;
		// Never let end precede start (future-dated trailing record).
		const end = rawEnd < rec.date ? rec.date : rawEnd;
		spans.push({
			start: rec.date,
			end,
			status: rec.status,
			...(rec.note ? { note: rec.note } : {}),
			open,
			intensity: rec.status === "active" ? noteToIntensity(rec.note) : 0,
		});
	}
	return spans;
}
