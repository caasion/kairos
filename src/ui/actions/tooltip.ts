// A Svelte action for Obsidian's own tooltip on an action-stack button:
//
//   <button aria-label="Delete task" use:tooltip={"Delete task"}>…</button>
//
// It opens to the LEFT, so it never covers the stack's buttons above or below.
// The stack (actionStack.ts) switches it to the right when the stack sits too
// near the window's left edge for a left tooltip. Use it in place of `title`,
// which would show a second, native tooltip. Obsidian's `setTooltip` also sets
// `aria-label` to the same text; keep the markup's `aria-label` equal to it so
// a re-render doesn't change the accessible name.

import { setTooltip } from "obsidian";

export function tooltip(node: HTMLElement, text: string) {
	setTooltip(node, text, { placement: "left" });
	return {
		update(next: string) {
			// No placement here: keep whatever side the stack last chose.
			setTooltip(node, next);
		},
	};
}
