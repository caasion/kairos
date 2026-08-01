// Options for the block picker (the "nest task under block" combo box).
//
// A day's blocks presented as pickable rows, mirroring associationOptions.ts:
// a pure projection from the domain (`Block[]`) to a flat, filterable list the
// picker renders without knowing about blocks. Shared so both the timeline (nest
// gesture) and, later, the grid can offer the same "move this task into a block"
// affordance from one source of truth.

import type { Block, TimeRange } from "./types";

export interface BlockOption {
  block: Block;
  // Display label — the block title.
  title: string;
  // "HH:MM–HH:MM" for a timed block, or undefined for an untimed one (e.g. the
  // Unscheduled inbox), so the picker can show/omit a time chip.
  timeLabel?: string;
  // Sort key: minutes-since-midnight of the block's start, or +∞ for untimed so
  // untimed blocks (the inbox) sort to the bottom, matching the file order.
  start: number;
  // True for the Unscheduled inbox and any other untimed block — the picker can
  // label these distinctly ("nest here to keep it unscheduled").
  untimed: boolean;
}

function fmt(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function timeLabelOf(time: TimeRange | undefined): string | undefined {
  return time ? `${fmt(time.start)}–${fmt(time.end)}` : undefined;
}

/**
 * Project a day's blocks into pickable options, sorted the way the timeline
 * shows them (timed by start, untimed pinned to the end). `exclude` drops a
 * block by source line — used to hide the task's current owner so "nest under
 * block" never offers a no-op move to where it already lives.
 */
export function blockOptions(
  blocks: Block[],
  exclude?: number,
): BlockOption[] {
  return blocks
    .filter((b) => b.source.line !== exclude)
    .map((b) => ({
      block: b,
      title: b.title,
      timeLabel: timeLabelOf(b.time),
      start: b.time ? b.time.start : Number.MAX_SAFE_INTEGER,
      untimed: b.time === undefined,
    }))
    .sort((a, b) => a.start - b.start);
}

/** Case-insensitive substring filter over titles (and time labels). */
export function filterBlockOptions(
  options: BlockOption[],
  query: string,
): BlockOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) =>
      o.title.toLowerCase().includes(q) ||
      (o.timeLabel?.toLowerCase().includes(q) ?? false),
  );
}
