// The routines week — the Routines view's Week tab, as data.
//
// Seven columns, Monday to Sunday, each the day its weekly block routines
// produce. It answers three questions the list can't (decision 119): do two
// routines collide on some day, where is the free time, and how much of each
// day do routines take. So each day carries the blocks that overlap another
// and the minutes its blocks cover, overlaps counted once.
//
// What no weekday column can hold is counted, not drawn: weekly tasks with no
// timed block to sit in, and monthly routines. Pure and vault-free.

import type { BlockRoutine, Routine, TaskRoutine } from "./routinesFile";
import { mondayFirst } from "./rules";

export interface WeekDay {
	/** 0 = Sunday … 6 = Saturday. */
	day: number;
	/** The block routines that repeat on this weekday, by start time. */
	blocks: BlockRoutine[];
	/** Blocks that overlap another block on this day. */
	overlaps: Set<BlockRoutine>;
	/** Minutes the day's blocks cover, overlapping time counted once. */
	minutes: number;
	/** The task routines that sit in each block on this day, in file order. */
	tasks: Map<BlockRoutine, TaskRoutine[]>;
}

export interface RoutinesWeek {
	/** Monday first. */
	days: WeekDay[];
	/** The hours the week's blocks span, padded to whole hours; absent with no blocks. */
	span?: { startHour: number; endHour: number };
	/** Weekly task routines that sit in no timed block on any of their days. */
	untimed: number;
	/** Monthly routines, which no weekday holds. */
	monthly: number;
}

function onWeekday(r: Routine, day: number): boolean {
	return r.rule.kind === "weekly" && r.rule.days.includes(day);
}

export function routinesWeek(routines: Routine[]): RoutinesWeek {
	const blocks = routines.filter((r): r is BlockRoutine => r.kind === "block" && r.rule.kind === "weekly");
	const tasks = routines.filter((r): r is TaskRoutine => r.kind === "task" && r.rule.kind === "weekly");

	const days = [1, 2, 3, 4, 5, 6, 0].map((day): WeekDay => {
		const own = blocks
			.filter((b) => onWeekday(b, day))
			.sort((a, b) => a.time.start - b.time.start || a.time.end - b.time.end || a.line - b.line);
		const inBlock = new Map<BlockRoutine, TaskRoutine[]>();
		for (const t of tasks) {
			if (!t.home || !onWeekday(t, day)) continue;
			const home = own.find((b) => b.title === t.home);
			if (home) inBlock.set(home, [...(inBlock.get(home) ?? []), t]);
		}
		return { day, blocks: own, overlaps: overlapping(own), minutes: coveredMinutes(own), tasks: inBlock };
	});

	let span: RoutinesWeek["span"];
	if (blocks.length > 0) {
		const startHour = Math.floor(Math.min(...blocks.map((b) => b.time.start)) / 60);
		const endHour = Math.min(24, Math.ceil(Math.max(...blocks.map((b) => b.time.end)) / 60));
		span = { startHour, endHour: Math.max(endHour, Math.min(24, startHour + 1)) };
	}

	const inABlock = (t: TaskRoutine) =>
		t.home !== undefined &&
		t.rule.kind === "weekly" &&
		t.rule.days.some((day) => blocks.some((b) => b.title === t.home && onWeekday(b, day)));

	return {
		days: days.sort((a, b) => mondayFirst(a.day) - mondayFirst(b.day)),
		...(span ? { span } : {}),
		untimed: tasks.filter((t) => !inABlock(t)).length,
		monthly: routines.filter((r) => r.rule.kind === "monthly").length,
	};
}

/** The blocks that share some time with another (touching end to start doesn't count). */
export function overlapping(blocks: BlockRoutine[]): Set<BlockRoutine> {
	const out = new Set<BlockRoutine>();
	for (const [i, a] of blocks.entries()) {
		for (const b of blocks.slice(i + 1)) {
			if (a.time.start < b.time.end && b.time.start < a.time.end) {
				out.add(a);
				out.add(b);
			}
		}
	}
	return out;
}

/** Minutes covered by the blocks' times, overlapping time counted once. */
export function coveredMinutes(blocks: BlockRoutine[]): number {
	const spans = blocks.map((b) => b.time).sort((a, b) => a.start - b.start);
	let total = 0;
	let end = -1;
	for (const { start, end: e } of spans) {
		if (e <= end) continue;
		total += e - Math.max(start, end);
		end = e;
	}
	return total;
}

/** A duration as the week's day headers show it: "45m", "2h", "6h 30m". */
export function formatDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m}m`;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
