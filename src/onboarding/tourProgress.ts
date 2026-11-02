// The tour's view of a day: what it needs to tell that the person made a block,
// renamed it, added a task to it or checked one off. The tour never hooks the
// writer; it watches the index's day store and diffs small summaries of it, so
// every view (and a hand edit of the note) counts the same.
//
// Pure: no Obsidian imports, so it's unit-tested in plain Node.

import type { Day, TaskStatus } from "../types";

/** One scheduled block, reduced to what the tour compares. */
export interface BlockSummary {
	line: number;
	title: string;
	start: number;
	end: number;
	tasks: { text: string; status: TaskStatus }[];
}

/**
 * The block the tour is following: the one the person made in step 2. Persisted
 * with the tour state, so a restart mid-tour still knows which block it was.
 */
export interface TrackedBlock {
	date: string;
	line: number;
	title: string;
	/** The title it was made with, so a rename is anything else. */
	createdTitle: string;
	start: number;
	end: number;
}

/**
 * The scheduled blocks of a day, copied out of the live objects: the Day view
 * mutates its blocks in place before it writes, so the tour can't keep the
 * references and diff them later.
 */
export function summarizeDay(day: Day | undefined): BlockSummary[] {
	if (!day) return [];
	const out: BlockSummary[] = [];
	for (const b of day.blocks) {
		if (!b.scheduled || !b.time) continue;
		out.push({
			line: b.source.line,
			title: b.title,
			start: b.time.start,
			end: b.time.end,
			tasks: b.tasks.map((t) => ({ text: t.text, status: t.status })),
		});
	}
	return out;
}

const key = (b: BlockSummary) => `${b.start}-${b.end}|${b.title}`;

/**
 * The block that's new in `now` compared with `baseline`, if the day gained one.
 * A retime or rename alone changes a key without adding a block, so the count
 * has to grow too.
 */
export function findNewBlock(
	baseline: BlockSummary[],
	now: BlockSummary[],
): BlockSummary | undefined {
	if (now.length <= baseline.length) return undefined;
	const before = new Set(baseline.map(key));
	return now.find((b) => !before.has(key(b)));
}

/**
 * Find the tracked block again in a fresh summary. Its source line changes when
 * the note is reparsed (a new block holds a placeholder line until then), and
 * its title and time change when the person edits it, so try each in turn: the
 * same line, then the same time, then the same title.
 */
export function locate(
	tracked: TrackedBlock,
	now: BlockSummary[],
): BlockSummary | undefined {
	return (
		now.find((b) => b.line === tracked.line) ??
		now.find((b) => b.start === tracked.start && b.end === tracked.end) ??
		now.find((b) => b.title === tracked.title)
	);
}

/** `tracked`, updated to where and what `found` says it is now. */
export function follow(tracked: TrackedBlock, found: BlockSummary): TrackedBlock {
	return {
		...tracked,
		line: found.line,
		title: found.title,
		start: found.start,
		end: found.end,
	};
}

export function track(date: string, b: BlockSummary): TrackedBlock {
	return {
		date,
		line: b.line,
		title: b.title,
		createdTitle: b.title,
		start: b.start,
		end: b.end,
	};
}

/**
 * Whether any task's status differs from `before`. Tasks are matched by text,
 * so a task added or reordered in between doesn't read as a status change.
 */
export function statusChanged(
	before: BlockSummary["tasks"],
	now: BlockSummary["tasks"],
): boolean {
	const was = new Map(before.map((t) => [t.text, t.status]));
	return now.some((t) => was.has(t.text) && was.get(t.text) !== t.status);
}
