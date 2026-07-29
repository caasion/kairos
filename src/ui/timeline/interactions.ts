// Timeline interaction engine
//
// Pure gesture math for the Day view: given where a pointer went down and where
// it is now, compute the new time range(s) for the block(s) being manipulated.
// It holds no Svelte state and touches no files — the component drives it with
// pointer coordinates and reads back a preview, then persists on drop.
//
// Four gestures, one shape:
//   move          drag a whole block (or a group) up/down in time
//   resize-top    drag a block's top edge (moves start, keeps end)
//   resize-bottom drag a block's bottom edge (moves end, keeps start)
//   create        drag on empty timeline to sketch a new block
//
// Everything snaps to `SNAP_MINUTES` and is clamped to the visible day. Blocks
// may overlap (spec §2.1), so there is no collision handling here at all.

import type { Block, Minutes, TimeRange } from "../../types";
import {
	MIN_BLOCK_MINUTES,
	SNAP_MINUTES,
	clampToDay,
	offsetToMinutes,
	snap,
	type TimelineGeometry,
} from "./layout";

export type GestureMode = "move" | "resize-top" | "resize-bottom" | "create";

// One captured block's starting range, so a gesture is computed as a delta from
// where it began rather than from the (already moving) preview.
interface Grip {
	block: Block;
	start: Minutes;
	end: Minutes;
}

export interface Gesture {
	mode: GestureMode;
	// Pointer offset (px from body top) where the gesture began.
	originOffset: number;
	// Blocks under manipulation with their ranges at gesture start. For `create`
	// this is empty and the draft is derived from origin + current instead.
	grips: Grip[];
	geo: TimelineGeometry;
}

/** Begin a move/resize gesture on one or more blocks. */
export function beginBlockGesture(
	mode: Exclude<GestureMode, "create">,
	blocks: Block[],
	originOffset: number,
	geo: TimelineGeometry,
): Gesture {
	const grips: Grip[] = [];
	for (const block of blocks) {
		if (!block.time) continue; // untimed blocks aren't on the timeline
		grips.push({ block, start: block.time.start, end: block.time.end });
	}
	return { mode, originOffset, grips, geo };
}

/** Begin a create gesture: an empty drag anchored at `originOffset`. */
export function beginCreateGesture(
	originOffset: number,
	geo: TimelineGeometry,
): Gesture {
	return { mode: "create", originOffset, grips: [], geo };
}

/**
 * The live result of a gesture at the current pointer offset.
 *
 * `ranges` maps each gripped block to its previewed range (for move/resize).
 * `draft` is the sketched range of a create gesture, or undefined until the
 * drag has covered at least one snap step.
 */
export interface GesturePreview {
	ranges: Map<Block, TimeRange>;
	draft?: TimeRange;
}

/** Compute the preview for a gesture given the current pointer offset. */
export function updateGesture(
	gesture: Gesture,
	currentOffset: number,
	path: string,
): GesturePreview {
	if (gesture.mode === "create") {
		return { ranges: new Map(), draft: createDraft(gesture, currentOffset) };
	}

	const deltaMin = snap(
		offsetToMinutes(currentOffset, gesture.geo) -
			offsetToMinutes(gesture.originOffset, gesture.geo),
	);

	const ranges = new Map<Block, TimeRange>();

	if (gesture.mode === "move") {
		// A group moves rigidly: clamp the shared delta so no block in the
		// selection leaves the day, then apply it to all of them.
		const clampedDelta = clampGroupDelta(gesture.grips, deltaMin, gesture.geo);
		for (const grip of gesture.grips) {
			ranges.set(grip.block, {
				start: grip.start + clampedDelta,
				end: grip.end + clampedDelta,
			});
		}
		return { ranges };
	}

	// Resize acts per block (a resized selection isn't rigid — each edge moves).
	for (const grip of gesture.grips) {
		ranges.set(grip.block, resizeGrip(gesture.mode, grip, deltaMin, gesture.geo));
	}
	return { ranges };

	// `path` is unused for move/resize but kept in the signature so `create`
	// (which needs it for the draft's throwaway source) shares one entry point.
	void path;
}

// ─── move ──────────────────────────────────────────────────────

// Largest-magnitude delta that keeps every gripped block inside the day. We
// find how far the group can shift up (until the earliest start hits the top)
// and down (until the latest end hits the bottom), then clamp the requested
// delta into that window.
function clampGroupDelta(
	grips: Grip[],
	delta: Minutes,
	geo: TimelineGeometry,
): Minutes {
	const dayStart = geo.startHour * 60;
	const dayEnd = geo.endHour * 60;

	let minStart = Infinity;
	let maxEnd = -Infinity;
	for (const g of grips) {
		minStart = Math.min(minStart, g.start);
		maxEnd = Math.max(maxEnd, g.end);
	}

	const lowerBound = dayStart - minStart; // most negative allowed shift
	const upperBound = dayEnd - maxEnd; // most positive allowed shift
	return Math.max(lowerBound, Math.min(upperBound, delta));
}

// ─── resize ────────────────────────────────────────────────────

function resizeGrip(
	mode: "resize-top" | "resize-bottom",
	grip: Grip,
	delta: Minutes,
	geo: TimelineGeometry,
): TimeRange {
	if (mode === "resize-top") {
		// Move the start; never past (end - min length), never above day start.
		const start = clampToDay(
			Math.min(grip.start + delta, grip.end - MIN_BLOCK_MINUTES),
			geo,
		);
		return { start, end: grip.end };
	}
	// resize-bottom: move the end; never before (start + min length), never past
	// day end.
	const end = clampToDay(
		Math.max(grip.end + delta, grip.start + MIN_BLOCK_MINUTES),
		geo,
	);
	return { start: grip.start, end };
}

// ─── create ────────────────────────────────────────────────────

// The draft spans from the anchor to the current pointer, in either direction,
// snapped and clamped. Returns undefined until it reaches the minimum length so
// a stray click doesn't create a zero-height block.
function createDraft(
	gesture: Gesture,
	currentOffset: number,
): TimeRange | undefined {
	const a = snap(clampToDay(offsetToMinutes(gesture.originOffset, gesture.geo), gesture.geo));
	const b = snap(clampToDay(offsetToMinutes(currentOffset, gesture.geo), gesture.geo));

	const start = Math.min(a, b);
	const end = Math.max(a, b);
	if (end - start < MIN_BLOCK_MINUTES) return undefined;
	return { start, end };
}

// Re-export so components import interaction constants from one place.
export { SNAP_MINUTES, MIN_BLOCK_MINUTES };
