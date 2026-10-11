// "Repeat…" — turning a task or block in a day into a routine.
//
// The action never makes a day task repeat (a task belongs to one day). It
// writes a new routine to the routines file, built from what the task already
// says, and the task it was started from stays put as the first occurrence:
//
//   • a block with a time (its own line) → a block routine at that time,
//     checkable if the block is;
//   • a task nested in a timed block → a task homed in a block of that title,
//     its block's association going on the home line it inherits from;
//   • a task in Unscheduled (or an untimed block) → a task for the day's list,
//     with the association it shows written explicitly.
//
// `repeatDraft` is pure. The views reach the plugin through `requestRepeat`, a
// plugin-wide handler the plugin installs on load (like the draft-line
// allocator), so the action needs no prop threaded through every view.

import type { Block, Task } from "../types";
import type { Rule } from "./rules";
import type { RoutineDraft } from "./routinesWriter";

/** Is `task` `block`'s own line (a checkable block's checkbox, or the block itself)? */
export function isBlockLine(task: Task, block: Block): boolean {
	return task.source.line === block.source.line;
}

/** The task-shaped stand-in for a block's own line, for `requestRepeat`. */
export function blockLineTask(block: Block): Task {
	return { source: block.source, text: block.title, status: block.status ?? " " };
}

export function repeatDraft(task: Task, block: Block, rule: Rule): RoutineDraft {
	if (isBlockLine(task, block)) {
		if (block.time) {
			return {
				kind: "block",
				rule,
				title: block.title,
				time: block.time,
				checkable: block.status !== undefined,
				...(block.assoc ? { assoc: block.assoc } : {}),
				...(block.metadata ? { metadata: block.metadata } : {}),
			};
		}
		return {
			kind: "task",
			rule,
			text: block.title,
			...(block.assoc ? { assoc: block.assoc } : {}),
			...(block.metadata ? { metadata: block.metadata } : {}),
		};
	}

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

type RepeatHandler = (task: Task, block: Block) => void;
let handler: RepeatHandler | undefined;

/** Installed by the plugin on load; cleared (undefined) on unload. */
export function setRepeatHandler(next: RepeatHandler | undefined): void {
	handler = next;
}

/** Open "Repeat…" for a task in `block`. A no-op before the plugin loads. */
export function requestRepeat(task: Task, block: Block): void {
	handler?.(task, block);
}
