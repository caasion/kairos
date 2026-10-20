// Day preparation, decided — the pure half of dayPrep.ts.
//
// `planDayPrep` takes everything the glue knows about one day (its blocks, its
// frontmatter keys, the previous note, the routines) and returns what should
// change: the new blocks for this day and the previous one, the frontmatter
// keys to set or delete, and an `outcome` the command turns into a message.
// dayPrep.ts only gathers the inputs and performs the writes, so every decision
// in the table below is unit-tested here without Obsidian.
//
//   mode     date            kairos-routines         routines
//   ───────  ──────────────  ──────────────────────  ─────────────────────────
//   auto     past            —                       never touched
//   auto     (setting off)   —                       not applied; outcome "off"
//   auto     today/future    absent                  applied, hash recorded
//   auto     today/future    equal to current hash   nothing
//   auto     today/future    different               nothing; outcome "stale"
//   manual   any             any                     applied, hash recorded
//
// Carry-over runs only in `auto` mode, only for today, and only once per note
// (`kairos-carried` absent). It runs before routines, so a routine task that
// carried in open from yesterday is found and not added a second time.
//
// Routines whose project or domain isn't active on the date are left out of
// everything here, the hash included (decision 87, owners.ts).

import type { Block, ISODate } from "../types";
import { CARRIED_KEY, carryOver } from "../carry";
import { ROUTINES_KEY, applyRoutines, routinesFor, routinesHash } from "./apply";
import { activeRoutines, type OwnerActive } from "./owners";
import type { ParsedRoutines, Routine } from "./routinesFile";

export type PrepMode = "auto" | "manual";

export interface PrepInput {
	mode: PrepMode;
	date: ISODate;
	today: ISODate;
	path: string;
	blocks: Block[];
	/** The note's `kairos-routines` value, if it has one. */
	recorded?: string;
	/** Whether the note already has a `kairos-carried` key. */
	carried: boolean;
	/** The most recent earlier daily note, for carry-over. */
	previous?: { date: ISODate; path: string; blocks: Block[] };
	routines: Routine[];
	/** Whether a routine's owner is active on a date; without it, every routine is. */
	active?: OwnerActive;
	/** The "Add routines to new daily notes" setting; only `auto` reads it. */
	autoApply: boolean;
}

export type PrepOutcome =
	| "past" // auto mode on a past day: nothing considered
	| "off" // auto mode with the setting off: carry-over only
	| "none-due" // no routines occur on this date
	| "added" // at least one routine item was added
	| "present" // routines are due and every one is already in the day
	| "recorded" // auto mode, hash matches: day was set up before
	| "stale"; // auto mode, hash differs: routines changed since set-up

export interface PrepPlan {
	outcome: PrepOutcome;
	/** This day's blocks after carry-over and routines. */
	blocks: Block[];
	/** The previous note's blocks after carry-over, when anything moved. */
	previous?: { date: ISODate; path: string; blocks: Block[] };
	/** How many tasks carried in. */
	carried: number;
	/** How many routine blocks/tasks were added. */
	added: number;
	/** How many routines occur on this date (active owners only). */
	due: number;
	/** How many more occur but are paused because their owner isn't active. */
	paused: number;
	/** Frontmatter keys to set (string) or delete (null). */
	frontmatter: Record<string, string | null>;
}

export function planDayPrep(input: PrepInput): PrepPlan {
	const { mode, date, today, path, recorded } = input;
	const scheduled = routinesFor(input.routines, date);
	const routines = activeRoutines(scheduled, date, input.active);
	const due = routines.length;
	const paused = scheduled.length - due;
	const frontmatter: Record<string, string | null> = {};

	if (mode === "auto" && date < today) {
		return { outcome: "past", blocks: input.blocks, carried: 0, added: 0, due, paused, frontmatter };
	}

	// Carry-over first, so routines see what carried in.
	let blocks = input.blocks;
	let previous: PrepPlan["previous"];
	let carried = 0;
	if (mode === "auto" && date === today && !input.carried && input.previous) {
		const r = carryOver(input.previous.blocks, blocks, path);
		if (r.moved > 0) {
			blocks = r.to;
			previous = { ...input.previous, blocks: r.from };
			carried = r.moved;
			frontmatter[CARRIED_KEY] = input.previous.date;
		}
	}

	const hash = routinesHash(routines, date);
	const base = { blocks, carried, due, paused, frontmatter, ...(previous ? { previous } : {}) };

	if (mode === "auto" && !input.autoApply) {
		return { ...base, outcome: "off", added: 0 };
	}

	if (mode === "auto" && recorded !== undefined) {
		const outcome = recorded === hash ? "recorded" : "stale";
		return { ...base, outcome, added: 0 };
	}

	const r = applyRoutines(blocks, routines, date, path);
	if (hash !== "" && hash !== recorded) frontmatter[ROUTINES_KEY] = hash;
	if (hash === "" && recorded !== undefined) frontmatter[ROUTINES_KEY] = null;

	const outcome: PrepOutcome =
		r.added > 0 ? "added" : due === 0 ? "none-due" : "present";
	return { ...base, blocks: r.blocks, outcome, added: r.added };
}

// ─── messages ──────────────────────────────────────────────────

/** "Thu, Oct 8" — a day as the command's messages name it. */
export function dayLabel(date: ISODate): string {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

/** What "Apply routines to this day" says once it has run. */
export function manualMessage(
	plan: PrepPlan,
	date: ISODate,
	parsed: ParsedRoutines,
	routinesPath: string,
): string {
	const day = dayLabel(date);
	let message: string;
	switch (plan.outcome) {
		case "added":
			message = `Added ${plan.added} item${plan.added === 1 ? "" : "s"} from routines to ${day}.`;
			break;
		case "present":
			message = `All ${plan.due} routine${plan.due === 1 ? " is" : "s are"} already in ${day}.`;
			break;
		default:
			message =
				parsed.routines.length === 0
					? `No routines found in ${routinesPath}.`
					: `No routines are due on ${day}.`;
	}
	if (plan.paused > 0) {
		const n = plan.paused;
		message += ` ${n} routine${n === 1 ? " is" : "s are"} paused because ${n === 1 ? "its" : "their"} project or domain isn't active then.`;
	}
	const first = parsed.problems[0];
	if (first) {
		const n = parsed.problems.length;
		message += ` ${routinesPath} has ${n} line${n === 1 ? "" : "s"} Kairos can't use (line ${first.line + 1}: ${first.message}).`;
	}
	return message;
}
