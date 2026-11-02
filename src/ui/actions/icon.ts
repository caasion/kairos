// Draws one of Obsidian's icons (Lucide names, like "plus" or "list-x") into
// an element, the same way Obsidian's own menus and buttons do. Use it instead
// of pasting an icon's SVG into markup: the icon then matches Obsidian's size
// and stroke, and follows its theme.
//
//   <span use:icon={"plus"}></span>
//
// Sized by Obsidian's `--icon-size` (set it on the element or a parent).

import { setIcon } from "obsidian";

export function icon(node: HTMLElement, name: string) {
	setIcon(node, name);
	return {
		update(next: string) {
			if (next !== name) {
				name = next;
				setIcon(node, name);
			}
		},
	};
}
