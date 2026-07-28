// Timeline geometry: the single source of truth for how minutes map to pixels
// in the Day view. Kept as plain data + pure functions so the layout math is
// unit-testable and free of Svelte.

import type { KairosSettings } from "../../settings";
import type { Block, Minutes } from "../../types";

export interface TimelineGeometry {
	startHour: number; // first hour shown in the gutter
	endHour: number; // last hour shown (exclusive of its label row)
	hourHeight: number; // pixels per hour
	topPad: number; // padding above the first hour line
}

const TOP_PAD = 8;

/**
 * Build timeline geometry from the plugin settings. `endHour` is clamped to
 * stay above `startHour` so the body always has positive height even if the
 * stored values momentarily disagree.
 */
export function geometryFromSettings(
	settings: KairosSettings,
): TimelineGeometry {
	const startHour = clamp(settings.timelineStartHour, 0, 23);
	const endHour = clamp(settings.timelineEndHour, startHour + 1, 24);
	const hourHeight = clamp(settings.timelineHourHeight, 20, 240);
	return { startHour, endHour, hourHeight, topPad: TOP_PAD };
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

/** Total pixel height of the timeline body for a given geometry. */
export function gridHeight(g: TimelineGeometry): number {
	return (g.endHour - g.startHour) * g.hourHeight + g.topPad;
}

/** The hours to render as gutter labels / grid lines. */
export function visibleHours(g: TimelineGeometry): number[] {
	const count = g.endHour - g.startHour;
	return Array.from({ length: count }, (_, i) => g.startHour + i);
}

/** Vertical offset (px from the top of the body) for a minutes-since-midnight value. */
export function minutesToOffset(minutes: Minutes, g: TimelineGeometry): number {
	return ((minutes - g.startHour * 60) / 60) * g.hourHeight + g.topPad;
}

/** A block's placement rectangle in the timeline body. */
export interface Placement {
	block: Block;
	top: number;
	height: number;
	column: number; // horizontal lane for overlap handling
	lanes: number; // total lanes in this block's overlap cluster
}

// Lay out timed blocks, giving overlapping blocks side-by-side lanes so none is
// hidden. Blocks are swept left to right by start time; a block joins the first
// lane whose previous occupant has already ended, otherwise a new lane opens.
// Clusters of mutually-overlapping blocks share a lane count so their widths
// match. Unscheduled (untimed) blocks are ignored here — they render below.
export function layoutBlocks(
	blocks: Block[],
	g: TimelineGeometry,
): Placement[] {
	const timed = blocks
		.filter((b): b is Block & { time: NonNullable<Block["time"]> } =>
			b.time !== undefined,
		)
		.sort((a, b) => a.time.start - b.time.start || a.time.end - b.time.end);

	const placements: Placement[] = [];
	let cluster: Placement[] = [];
	let clusterEnd = -1;
	const laneEnds: number[] = []; // end-minute of the block currently in each lane

	const flush = () => {
		const lanes = laneEnds.length;
		for (const p of cluster) p.lanes = lanes;
		laneEnds.length = 0;
		cluster = [];
		clusterEnd = -1;
	};

	for (const block of timed) {
		const { start, end } = block.time;

		// A gap with no overlap closes the current cluster.
		if (start >= clusterEnd && cluster.length > 0) flush();

		// Find the first free lane (its occupant ended by our start), else open one.
		let column = laneEnds.findIndex((laneEnd) => laneEnd <= start);
		if (column === -1) {
			column = laneEnds.length;
			laneEnds.push(end);
		} else {
			laneEnds[column] = end;
		}

		const placement: Placement = {
			block,
			top: minutesToOffset(start, g),
			height: Math.max(
				((end - start) / 60) * g.hourHeight,
				g.hourHeight / 4,
			),
			column,
			lanes: 1,
		};
		placements.push(placement);
		cluster.push(placement);
		clusterEnd = Math.max(clusterEnd, end);
	}

	if (cluster.length > 0) flush();
	return placements;
}
