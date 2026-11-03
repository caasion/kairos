// Touch's stand-in for the hover corner and right-click (spec decision 128).
// A row with an action bar (`actionZone`) is selected by a first tap, which
// shows its bar; a second tap reaches the row as a click does with a mouse
// (edit the text, and so on). A selected row's bar ends in a ⋯ button that
// opens the row's right-click menu, for rows that have one (`menu`).
//
// - One row is selected at a time, across every view. A press anywhere
//   outside it clears it.
// - The innermost row wins: a tap on a task inside a timeline block selects
//   the task, not the block.
// - Taps on the bar itself, form fields, links and anything marked
//   `data-kairos-tap-through` (a checkbox, an insert arrow) act at once.
// - Mouse is untouched: only a click that follows a touch or pen press is
//   held back. Press and hold (drag, peek) starts on pointerdown, so it never
//   waits for selection.
// - A touch long-press never opens the row's menu (Android and Chrome send it
//   as a right-click): press and hold means drag, and ⋯ is the menu.

import { setIcon } from "obsidian";

/** On the row while it is selected by touch; it also wakes the row's bar. */
export const TOUCH_SELECTED_CLASS = "kairos-touch-selected";
/** The ⋯ button added to a selected row's bar. */
export const TOUCH_MENU_CLASS = "kairos-touch-menu";
/** Marks an element inside a row that a tap uses at once, unselected or not. */
export const TAP_THROUGH_ATTR = "data-kairos-tap-through";

const TAP_THROUGH = [
	".kairos-action-bar",
	"input",
	"textarea",
	"select",
	"a",
	"[contenteditable]",
	`[${TAP_THROUGH_ATTR}]`,
].join(", ");

interface Selection {
	host: HTMLElement;
	clear: () => void;
}
let current: Selection | null = null;

export interface TouchSelectOptions {
	/** The row's bar, looked up when needed (it may render conditionally). */
	findBar: () => HTMLElement | null;
	/** Whether `el` belongs to this row and not to a row nested inside it. */
	ownsTarget: (el: Element) => boolean;
	/** Class to put on the row while selected, so its bar shows. */
	awakeClass: string;
	/** The row has a right-click menu: add ⋯ to its bar. */
	menu: () => boolean;
}

function isTouch(type: string): boolean {
	return type === "touch" || type === "pen";
}

export function touchSelect(host: HTMLElement, opts: TouchSelectOptions) {
	const doc = host.ownerDocument;
	let lastPress = "";
	let menuButton: HTMLButtonElement | null = null;

	function onPointerDown(event: PointerEvent) {
		lastPress = event.pointerType;
	}

	function onClick(event: MouseEvent) {
		if (!isTouch(lastPress)) return;
		if (current?.host === host) return;
		const target = event.target as Partial<Element> | null;
		// Duck-typed: `instanceof Element` fails across pop-out windows.
		if (typeof target?.closest !== "function") return;
		const el = target as Element;
		if (!opts.ownsTarget(el)) return;
		if (el.closest(TAP_THROUGH)) return;
		event.preventDefault();
		event.stopPropagation();
		select();
	}

	function select() {
		current?.clear();
		current = { host, clear: deselect };
		host.classList.add(TOUCH_SELECTED_CLASS, opts.awakeClass);
		const bar = opts.findBar();
		if (bar && opts.menu()) addMenuButton(bar);
		doc.addEventListener("pointerdown", onOutsidePress, true);
	}

	function deselect() {
		if (current?.host === host) current = null;
		host.classList.remove(TOUCH_SELECTED_CLASS, opts.awakeClass);
		menuButton?.remove();
		menuButton = null;
		doc.removeEventListener("pointerdown", onOutsidePress, true);
	}

	function onOutsidePress(event: PointerEvent) {
		const target = event.target as Node | null;
		// The bar counts as the row's even when it isn't its child (a stack
		// moved to the body), so a press on ⋯ doesn't drop the selection.
		if (target && (host.contains(target) || opts.findBar()?.contains(target))) return;
		deselect();
	}

	function addMenuButton(bar: HTMLElement) {
		const button = doc.createElement("button");
		button.className = `clickable-icon kairos-icon-button ${TOUCH_MENU_CLASS}`;
		button.setAttribute("aria-label", "More actions");
		setIcon(button, "more-horizontal");
		// Like the bar's other buttons: a press here is the button's, never the
		// start of the row's own gesture (a block's move).
		button.addEventListener("pointerdown", (event) => event.stopPropagation());
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			const rect = button.getBoundingClientRect();
			// The row's own right-click handler opens the menu, at the button.
			host.dispatchEvent(
				new MouseEvent("contextmenu", {
					bubbles: true,
					cancelable: true,
					clientX: rect.left,
					clientY: rect.bottom,
				}),
			);
		});
		bar.appendChild(button);
		menuButton = button;
	}

	// The long-press's right-click is a touch PointerEvent; the ⋯ button's own
	// is a plain MouseEvent with no pointer type, and goes through.
	function onContextMenu(event: MouseEvent) {
		const type = (event as Partial<PointerEvent>).pointerType;
		if (type && isTouch(type)) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	host.addEventListener("pointerdown", onPointerDown, true);
	host.addEventListener("click", onClick, true);
	host.addEventListener("contextmenu", onContextMenu, true);

	return {
		destroy() {
			host.removeEventListener("pointerdown", onPointerDown, true);
			host.removeEventListener("click", onClick, true);
			host.removeEventListener("contextmenu", onContextMenu, true);
			if (current?.host === host) deselect();
		},
	};
}
