// "Repeat…" — turning a task or block in a day into a routine.
//
// The action never makes a day task repeat (a task belongs to one day). It
// writes a new routine to the routines file, built from what the task already
// says, and the task it was started from stays put as the first occurrence:
//
//   • a block with a time (its own line) → a block routine at that time;
//   • a task nested in a timed block → a task homed in a block of that title,
//     its block's association going on the home line it inherits from;
//   • a task in Unscheduled (or an untimed block) → a task for the day's list,
//     with the association it shows written explicitly.
//
// `repeatDraft` and `blockRepeatDraft` are pure. The views reach the plugin
// through `requestRepeat` (a task) and `requestRepeatBlock` (a block), a
// plugin-wide handler the plugin installs on load (like the draft-line
// allocator), so the action needs no prop threaded through every view.

import type { Block, Task, TimeRange } from "../types";
import type { Rule } from "./rules";
import type { RoutineDraft } from "./routinesWriter";

/** A timed block → a block routine at that time. */
export function blockRepeatDraft(block: Block, time: TimeRange, rule: Rule): RoutineDraft {
	return {
		kind: "block",
		rule,
		title: block.title,
		time,
		...(block.assoc ? { assoc: block.assoc } : {}),
		...(block.metadata ? { metadata: block.metadata } : {}),
	};
}

/** A task in `block` → a task routine, homed in the block when it's timed. */
export function repeatDraft(task: Task, block: Block, rule: Rule): RoutineDraft {
	if (block.time) {
		return {
			kind: "task",
			rule,
			text: task.text,
			home: block.title,
			...(task.assoc ? { assoc: task.assoc } : {}),
			...(block.assoc ? { homeAssoc: block.assoc } : {}),
			...(task.metadata ? { metadata: task.metadata } : {}),
		};
	}

	const assoc = task.assoc ?? block.assoc;
	return {
		kind: "task",
		rule,
		text: task.text,
		...(assoc ? { assoc } : {}),
		...(task.metadata ? { metadata: task.metadata } : {}),
	};
}

// ─── the plugin-wide request channel ───────────────────────────

/** `task` absent: repeat the block itself. */
type RepeatHandler = (block: Block, task?: Task) => void;
let handler: RepeatHandler | undefined;

/** Installed by the plugin on load; cleared (undefined) on unload. */
export function setRepeatHandler(next: RepeatHandler | undefined): void {
	handler = next;
}

/** Open "Repeat…" for a task in `block`. A no-op before the plugin loads. */
export function requestRepeat(task: Task, block: Block): void {
	handler?.(block, task);
}

/** Open "Repeat…" for a timed block itself. A no-op before the plugin loads. */
export function requestRepeatBlock(block: Block): void {
	handler?.(block);
}
