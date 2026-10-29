// The Timeline bar's "Intensity" menu item (#73): one item whose submenu lists
// the levels 0–5, with the current one checked, plus "Clear" when a level is
// set. On an Obsidian without submenus the same choices go flat into the menu.

import type { Menu } from "obsidian";
import { INTENSITY_MAX } from "../../projectFile";
import { hasSubmenus, submenuOf } from "../projects/projectMenu";

/** A level's title in the submenu; the two ends say what they mean. */
function levelTitle(level: number): string {
	if (level === 0) return "0 · no time going in";
	if (level === INTENSITY_MAX) return `${level} · all in`;
	return String(level);
}

/**
 * Add the intensity choices to `menu`. `current` is the span's level (undefined
 * when unrated); `set` receives the picked level, or undefined to clear it.
 */
export function addIntensityItem(
	menu: Menu,
	current: number | undefined,
	set: (level: number | undefined) => void,
): void {
	if (!hasSubmenus()) {
		addLevels(menu, current, set, true);
		return;
	}
	menu.addItem((item) => {
		item.setTitle("Intensity").setIcon("gauge").setSection("intensity");
		addLevels(submenuOf(item), current, set, false);
	});
}

// Flat items sit among the other bar actions, so they're titled in full.
function addLevels(
	target: Menu,
	current: number | undefined,
	set: (level: number | undefined) => void,
	flat: boolean,
): void {
	for (let level = 0; level <= INTENSITY_MAX; level++) {
		target.addItem((item) =>
			item
				.setTitle(flat ? `Intensity ${level}` : levelTitle(level))
				.setSection("intensity")
				.setChecked(current === level)
				.onClick(() => set(level)),
		);
	}
	if (current !== undefined) {
		target.addItem((item) =>
			item
				.setTitle(flat ? "Clear intensity" : "Clear")
				.setSection(flat ? "intensity" : "clear")
				.onClick(() => set(undefined)),
		);
	}
}
