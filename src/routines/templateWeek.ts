// The template week — what the routines add up to, Monday to Sunday.
//
// The Routines view shows the list (where routines are edited) beside a
// simplified, read-only week (decision 92): one column per weekday holding the
// block routines that repeat on it, at their times. It answers "what does my
// week look like?" without a second place to edit. Things that don't sit on a
// weekday at a time go in a strip above it: weekly tasks with no timed block,
// and monthly routines.
//
// Hover links a routine across the list and the week (`routineLink`): every
// copy of a block that repeats on several days lights together, along with the
// tasks homed in it. Pure and vault-free.

import type { BlockRoutine, Routine, TaskRoutine } from "./routinesFile";
import { mondayFirst } from "./rules";

export interface TemplateDay {
	/** 0 = Sunday … 6 = Saturday. */
	day: number;
	/** The block routines that repeat on this weekday, by start time. */
	blocks: BlockRoutine[];
}

export interface TemplateWeek {
	/** Monday first. */
	days: TemplateDay[];
	/** The hours the week's blocks span, padded to whole hours. */
	startHour: number;
	endHour: number;
	/** Weekly tasks with no timed block to sit in. */
	untimed: TaskRoutine[];
	/** Monthly routines, which no weekday holds. */
	monthly: Routine[];
}

const DEFAULT_HOURS = { startHour: 8, endHour: 18 };

function onWeekday(r: Routine, day: number): boolean {
	return r.rule.kind === "weekly" && r.rule.days.includes(day);
}

/** The timed block routine a task routine sits in on `day`, if any. */
function homeBlock(task: TaskRoutine, blocks: BlockRoutine[], day: number): BlockRoutine | undefined {
	if (!task.home) return undefined;
	return blocks.find((b) => b.title === task.home && onWeekday(b, day));
}

export function templateWeek(routines: Routine[]): TemplateWeek {
	const blocks = routines.filter((r): r is BlockRoutine => r.kind === "block");
	const tasks = routines.filter((r): r is TaskRoutine => r.kind === "task");

	const days: TemplateDay[] = [0, 1, 2, 3, 4, 5, 6]
		.sort((a, b) => mondayFirst(a) - mondayFirst(b))
		.map((day) => ({
			day,
			blocks: blocks
				.filter((b) => onWeekday(b, day))
				.sort((a, b) => a.time.start - b.time.start || a.time.end - b.time.end),
		}));

	const weekly = blocks.filter((b) => b.rule.kind === "weekly");
	let startHour = DEFAULT_HOURS.startHour;
	let endHour = DEFAULT_HOURS.endHour;
	if (weekly.length > 0) {
		startHour = Math.floor(Math.min(...weekly.map((b) => b.time.start)) / 60);
		endHour = Math.min(24, Math.ceil(Math.max(...weekly.map((b) => b.time.end)) / 60));
		if (endHour <= startHour) endHour = Math.min(24, startHour + 1);
	}

	const untimed = tasks.filter(
		(t) =>
			t.rule.kind === "weekly" &&
			!t.rule.days.some((day) => homeBlock(t, blocks, day)),
	);
	const monthly = routines.filter((r) => r.rule.kind === "monthly");

	return { days, startHour, endHour, untimed, monthly };
}

/** How many task routines sit in `block` on `day`. */
export function tasksInBlock(routines: Routine[], block: BlockRoutine, day: number): number {
	return routines.filter(
		(r) => r.kind === "task" && r.home === block.title && onWeekday(r, day),
	).length;
}

/**
 * What hovering a routine lights up, as one key (a routines-file line): a block
 * is itself; a task homed in a timed block routine is that block, so pointing
 * at either lights the block on every day it repeats and the tasks in it; any
 * other task is just itself.
 */
export function routineLink(routines: Routine[]): (r: Routine) => number {
	const blocks = routines.filter((r): r is BlockRoutine => r.kind === "block");
	return (r) => {
		if (r.kind === "block" || !r.home) return r.line;
		return blocks.find((b) => b.title === r.home)?.line ?? r.line;
	};
}
