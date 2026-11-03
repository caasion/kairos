// A day's menu, shared by every place a day has a header: the Day view's date,
// the Week view's date cards and the Grid's date headers, so a day offers the
// same actions wherever you meet it. Right-click opens it, and so does the ⋯
// button on each header, which shows the menu is there. The Day view's tab ⋯
// menu adds the same items.

import { Menu, TFile } from "obsidian";
import type { App } from "obsidian";
import type { ISODate } from "../types";
import type { RoutineActions } from "../routines/routinesFeed";
import { ensureNoteForDate, todayISO } from "../dayNote";

/** Add the day's items to `menu`. Past days keep their routines as they were. */
export function addDayMenuItems(
	menu: Menu,
	date: ISODate,
	actions: Pick<RoutineActions, "regenerate">,
	app?: App,
): void {
	// What Ctrl/Cmd+click on the date does, for touch, where there's no
	// modifier. Makes the note if the day has none yet.
	if (app) {
		menu.addItem((item) =>
			item
				.setTitle("Open daily note")
				.setIcon("file-text")
				.setSection("open")
				.onClick(() => void openDailyNote(app, date)),
		);
	}
	const past = date < todayISO();
	menu.addItem((item) =>
		item
			.setTitle(past ? "Regenerate routines (past day)" : "Regenerate routines…")
			.setIcon("refresh-cw")
			.setSection("action")
			.setDisabled(past)
			.onClick(() => actions.regenerate(date)),
	);
}

/**
 * Open the day's menu: at the pointer for a right-click, or under the ⋯
 * button that was pressed.
 */
export function showDayMenu(
	event: MouseEvent,
	date: ISODate,
	actions: Pick<RoutineActions, "regenerate">,
	app?: App,
): void {
	event.preventDefault();
	event.stopPropagation();
	const menu = new Menu();
	addDayMenuItems(menu, date, actions, app);
	const button = event.type === "click" ? (event.currentTarget as HTMLElement | null) : null;
	if (button) {
		const r = button.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom });
	} else {
		menu.showAtMouseEvent(event);
	}
}

/** Open the day's note in a new tab, making it if it doesn't exist yet. */
async function openDailyNote(app: App, date: ISODate): Promise<void> {
	const path = await ensureNoteForDate(date);
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) await app.workspace.getLeaf("tab").openFile(file);
}
