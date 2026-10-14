// What counts as still using a timeline block that has grown to show all its
// tasks (TimelineBlock.svelte). It shrinks back once the pointer leaves it, or
// on a press elsewhere, and shrinking unmounts the tasks that only show while
// grown. But a task's UI isn't all inside the block's DOM: its action stack
// may be portaled to the body (actionStack.ts), and its context menu and
// pickers float outside the block. Shrinking while one of those is in use
// takes the task, and its stack, away under the pointer: "Delete task" is
// gone before its click lands.

import { ACTIONS_AWAKE_CLASS } from "../actions/actionZone";
import { containsWithStacks } from "../actions/stackOwner";

/**
 * Floating UI a block or its tasks open outside the block: Obsidian's context
 * menu and the association and nest pickers.
 */
export const BLOCK_OVERLAY_SELECTOR = "body > .menu, .assoc-picker, .block-picker";

/** Whether focus is in the block, counting its tasks' portaled stacks. */
export function focusInBlock(block: Element): boolean {
	return containsWithStacks(block, block.ownerDocument.activeElement);
}

/**
 * Whether a grown block the pointer has left should wait before shrinking:
 * an action stack in it is still up (the pointer is on it, wherever it was
 * portaled), a menu or picker is open, or the pointer is back over it without
 * having crossed in (a portaled stack it was on vanished, e.g. its task was
 * just deleted).
 */
export function blockInUse(block: Element): boolean {
	const awake = `.${ACTIONS_AWAKE_CLASS}`;
	if (block.matches(awake) || block.querySelector(awake)) return true;
	if (block.matches(":hover")) return true;
	return block.ownerDocument.querySelector(BLOCK_OVERLAY_SELECTOR) !== null;
}

/** Whether a press on `target` is on the block or on UI it opened (so it stays grown). */
export function pressInBlock(block: Element, target: EventTarget | null): boolean {
	if (containsWithStacks(block, target as Node | null)) return true;
	// Duck-typed: `instanceof Element` fails across pop-out windows.
	const el = target as Partial<Element> | null;
	return typeof el?.closest === "function" && el.closest(BLOCK_OVERLAY_SELECTOR) !== null;
}
