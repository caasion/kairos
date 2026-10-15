// A block's context menu items, shared by the timeline's blocks and the Grid's
// block headers so the two menus stay identical: Add task, Add note, the
// association, Repeat…, Open in day view, and Delete block. A block has no
// status, so there are no status items. Each view supplies the handlers (the timeline edits
// its blocks in place, the Grid commits a pure writer transform); this only
// decides which items show and in what order.
//
// Only a type comes from `obsidian`, so this stays importable from a unit test.

import type { Menu } from "obsidian";
import type { Block } from "../types";
import { requestRepeatBlock } from "../routines/repeat";

export interface BlockMenuActions {
	/** A new task in the block. Omitted where none can be added. */
	onAddTask?: () => void;
	/** A new note in the block. Omitted where notes aren't shown. */
	onAddNote?: () => void;
	/** Open the association picker for the block. */
	onEditAssoc: () => void;
	onDelete: () => void;
	/** Open the block in the Day view (the Grid; the timeline is already there). */
	onReveal?: () => void;
}

/** "Open in day view". */
export function addRevealItem(menu: Menu, onReveal: () => void): void {
	menu.addItem((item) =>
		item
			.setTitle("Open in day view")
			.setIcon("calendar-clock")
			.onClick(() => onReveal()),
	);
}

/** Add a block's full menu to `menu`. */
export function addBlockMenuItems(menu: Menu, block: Block, actions: BlockMenuActions): void {
	const { onAddTask, onAddNote, onReveal } = actions;
	if (onAddTask) {
		menu.addItem((item) =>
			item
				.setTitle("Add task")
				.setIcon("list-plus")
				.onClick(() => onAddTask()),
		);
	}
	if (onAddNote) {
		menu.addItem((item) =>
			item
				.setTitle("Add note")
				.setIcon("sticky-note")
				.onClick(() => onAddNote()),
		);
	}
	menu.addItem((item) =>
		item
			.setTitle(block.assoc ? "Edit association" : "Add association")
			.setIcon("folder-symlink")
			.onClick(() => actions.onEditAssoc()),
	);
	if (block.time) {
		menu.addItem((item) =>
			item
				.setTitle("Repeat…")
				.setIcon("repeat")
				.onClick(() => requestRepeatBlock(block)),
		);
	}
	if (onReveal) addRevealItem(menu, onReveal);

	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Delete block")
			.setIcon("trash")
			.onClick(() => actions.onDelete()),
	);
}
