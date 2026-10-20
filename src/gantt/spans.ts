// Gantt/strength view: derive renderable spans from a status history.
//
// The history array is the single temporal record; there is no stored "span".
// Each record opens a span that runs until the next record's date (the last span
// is open-ended, rendered as running to `today`). This module is pure and
// vault-free so it runs under vitest, mirroring projectFile.ts.
//
// A span's `note` is freeform prose, the intention for that stretch ("get it
// done this week") — an open label, never logic and never a keyword (#29). How
// hard the stretch is pushed is a separate, explicit field: the record's 0–5
// `intensity`, carried onto active spans only.

import type { ISODate, LifecycleState, StatusRecord } from "../types";

export interface Span {
	start: ISODate;
	/** Exclusive-ish end used for rendering; the open last span ends at `today`. */
	end: ISODate;
	status: LifecycleState;
	note?: string;
	/** Why the entity moved into this state — copied from the record verbatim. */
	why?: string;
	/** True for the trailing, still-running span (no successor record). */
	open: boolean;
	/** The record's 0–5 intensity. Only set on an active span that has one. */
	intensity?: number;
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
		const rawEnd = open ? today : next.date;
		// Never let end precede start (future-dated trailing record).
		const end = rawEnd < rec.date ? rec.date : rawEnd;
		spans.push({
			start: rec.date,
			end,
			status: rec.status,
			...(rec.note ? { note: rec.note } : {}),
			...(rec.why ? { why: rec.why } : {}),
			...(rec.status === "active" && rec.intensity !== undefined
				? { intensity: rec.intensity }
				: {}),
			open,
		});
	}
	return spans;
}
