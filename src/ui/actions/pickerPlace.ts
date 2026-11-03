// Where a picker panel (association, block) opens: just under its anchor,
// flipped above when there's no room below, and kept inside the part of the
// screen that's visible. On iOS the keyboard covers the page without shrinking
// `window.innerHeight`, so the visible part is the visual viewport.

export interface Area {
	top: number;
	left: number;
	width: number;
	height: number;
}

const MARGIN = 6;

/** The visible part of `win`'s page: the visual viewport when there is one. */
export function visibleArea(win: Window): Area {
	const vv = win.visualViewport;
	if (vv) return { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height };
	return { top: 0, left: 0, width: win.innerWidth, height: win.innerHeight };
}

/** The panel's fixed-position top-left for an anchor rect. Pure, for tests. */
export function placePanel(
	anchor: { top: number; bottom: number; left: number },
	panel: { width: number; height: number },
	area: Area,
): { top: number; left: number } {
	const bottom = area.top + area.height;
	const right = area.left + area.width;
	const left = Math.max(area.left + MARGIN, Math.min(anchor.left, right - panel.width - MARGIN));
	const below = anchor.bottom + MARGIN;
	const above = anchor.top - MARGIN - panel.height;
	const fitsBelow = below + panel.height <= bottom - MARGIN;
	let top = fitsBelow || above < area.top + MARGIN ? below : above;
	// Still too tall for either side (a keyboard is up): keep it on screen.
	top = Math.min(top, bottom - MARGIN - panel.height);
	return { top: Math.max(area.top + MARGIN, top), left };
}

/** Whether the device's main pointer is a finger, so typing means a keyboard pops up. */
export function coarsePointer(win: Window): boolean {
	return win.matchMedia?.("(pointer: coarse)").matches ?? false;
}
