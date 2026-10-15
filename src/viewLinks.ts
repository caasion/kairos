// Cross-view links between the Grid and the timelines (Day, Week).
//
// The Grid is where you decide what a task is and whose it is; Day and Week are
// where you decide when. These stores are the bridge between them. Like
// `reveal$`, they live on the plugin so no view ever holds a handle to another:
// each view publishes what it's doing and subscribes to what it cares about.
//
// They're separate stores, not one, because they change at very different
// rates. Focus changes when you act; a drag preview changes as the pointer
// crosses blocks; hover changes as you move the mouse. Folding them together
// would make the Day view navigate every time you hovered a task.
//
//   focus$     the day you're working on in the Grid. The Day view follows it
//              (when "Follow Grid" is on).
//   drag$      a task drag in progress, from any view, and where it would land.
//              Every timeline draws the drop line / new-block preview from it,
//              so a drag that began elsewhere still shows where it will land.
//   hover$     the task or block under the pointer, so the same item can glow
//              in every view.
//   dayDate$   the date the Day view is showing, so the Grid can mark it.

import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { Block, ISODate, Task } from "./types";
import { sameDrop, type TimelineDrop } from "./taskDrop";

/**
 * A request for the Day view to show `date`. `nonce` makes repeats distinct.
 * `explicit` marks a direct ask (a Grid column header click), which the Day
 * view honours even when it isn't following the Grid.
 */
export interface FocusRequest {
	date: ISODate;
	nonce: number;
	explicit: boolean;
}

/** A live task drag, as every timeline needs to see it. */
export interface DragPreview {
	/** Where the dragged task sits now, so its row can dim in any view. */
	from: { date: ISODate; line: number };
	/** Where it would land if released now, or null over nothing droppable. */
	drop: TimelineDrop | null;
	/** The title a drop on empty time would give the new block. */
	label: string;
	/** Modifier state, so the preview can show "copy". */
	duplicate: boolean;
}

/**
 * The item under the pointer. `block` is the line of the block it lights up as
 * a whole: the block itself, or the timed block a task sits in. A task in an
 * untimed block (Unscheduled) has none, so pointing at it lights only it.
 */
export interface HoverTarget {
	kind: "task" | "block";
	path: string;
	line: number;
	block?: number;
}

// ── The one highlight rule, shared by every view ──
//
// Two levels. Pointing at anything in a block lights the *block*: its header
// and every task in it in the Grid, the block itself in the timelines. Pointing
// at a task also marks *that task*, wherever it shows. The item under the
// pointer lights up like the rest, so a group reads as one.

/** How an item is lit: as part of the hovered block, or as the hovered task. */
export type Highlight = "block" | "task" | null;

export function hoverBlockTarget(block: Block): HoverTarget {
	const { path, line } = block.source;
	return { kind: "block", path, line, block: line };
}

export function hoverTaskTarget(task: Task, owner: Block): HoverTarget {
	const { path, line } = task.source;
	return owner.time
		? { kind: "task", path, line, block: owner.source.line }
		: { kind: "task", path, line };
}

/** Whether the hover lights `block` as a whole. */
export function blockLit(hover: HoverTarget | null, block: Block): boolean {
	return (
		!!hover &&
		hover.block !== undefined &&
		hover.path === block.source.path &&
		hover.block === block.source.line
	);
}

/** How `task`, sitting in `owner`, is lit by the hover. */
export function taskHighlight(
	hover: HoverTarget | null,
	task: Task,
	owner: Block,
): Highlight {
	if (!hover) return null;
	if (
		hover.kind === "task" &&
		hover.path === task.source.path &&
		hover.line === task.source.line
	) {
		return "task";
	}
	return blockLit(hover, owner) ? "block" : null;
}

export class ViewLinks {
	readonly focus$: Readable<FocusRequest | null>;
	readonly drag$: Readable<DragPreview | null>;
	readonly hover$: Readable<HoverTarget | null>;
	readonly dayDate$: Readable<ISODate | null>;

	private readonly focusStore = writable<FocusRequest | null>(null);
	private readonly dragStore = writable<DragPreview | null>(null);
	private readonly hoverStore = writable<HoverTarget | null>(null);
	private readonly dayDateStore = writable<ISODate | null>(null);
	private focusNonce = 0;
	private drag: DragPreview | null = null;
	private hover: HoverTarget | null = null;
	private hoverEnabled = true;

	constructor() {
		this.focus$ = { subscribe: this.focusStore.subscribe };
		this.drag$ = { subscribe: this.dragStore.subscribe };
		this.hover$ = { subscribe: this.hoverStore.subscribe };
		this.dayDate$ = { subscribe: this.dayDateStore.subscribe };
	}

	/**
	 * Ask the Day view to show `date`. An implicit request (you acted on that
	 * day) is followed only when "Follow the grid" is on; an explicit one always.
	 */
	focus(date: ISODate, explicit = false): void {
		this.focusStore.set({ date, nonce: ++this.focusNonce, explicit });
	}

	/**
	 * Mark an explicit request as handled, so a Day view that mounts later
	 * doesn't act on it again. Leaves a newer request alone.
	 */
	consumeFocus(nonce: number): void {
		if (get(this.focusStore)?.nonce === nonce) this.focusStore.set(null);
	}

	/**
	 * Publish the live drag, or null when it ends. Called on every pointer move,
	 * so it only notifies when something a timeline draws actually changed.
	 */
	setDrag(next: DragPreview | null): void {
		const prev = this.drag;
		if (prev === next) return;
		if (
			prev &&
			next &&
			prev.from.date === next.from.date &&
			prev.from.line === next.from.line &&
			prev.label === next.label &&
			prev.duplicate === next.duplicate &&
			sameDrop(prev.drop, next.drop)
		) {
			return;
		}
		this.drag = next;
		this.dragStore.set(next);
		// A drag has its own highlight; a stale hover glow would compete with it.
		if (next) this.setHover(null);
	}

	/**
	 * Turn the hover link on or off (the "Highlight across views" setting).
	 * Turning it off clears any highlight showing now.
	 */
	setHoverEnabled(on: boolean): void {
		this.hoverEnabled = on;
		if (!on) this.setHover(null);
	}

	/** Publish the item under the pointer. Ignored while a drag is live. */
	setHover(next: HoverTarget | null): void {
		if (next && (this.drag || !this.hoverEnabled)) return;
		// Unsaved items carry a throwaway negative line that changes on reparse.
		if (next && next.line < 0) next = null;
		const prev = this.hover;
		if (
			prev === next ||
			(prev && next && prev.kind === next.kind && prev.path === next.path && prev.line === next.line)
		) {
			return;
		}
		this.hover = next;
		this.hoverStore.set(next);
	}

	/** Clear the hover only if it still names this item (pointer left it). */
	clearHover(target: HoverTarget): void {
		const h = this.hover;
		if (h && h.kind === target.kind && h.path === target.path && h.line === target.line) {
			this.setHover(null);
		}
	}

	/** The Day view reports the date it's showing (null when it closes). */
	setDayDate(date: ISODate | null): void {
		this.dayDateStore.set(date);
	}
}
