// Drag-to-nest: shared hit-testing for dragging a task between blocks.
//
// A task drag is owned by the canvas (DayView / a Week column) because the drop
// target is a *sibling* block the task itself can't see. The canvas tracks the
// window pointer during the drag and, on each move, asks this module where the
// pointer is over the block/task DOM. Kept here (not in a component) so the Day
// and Week views share one hit-test and behave identically — and so the grid can
// reuse it when it grows the same gesture later.
//
// The DOM contract, emitted by TimelineBlock:
//   • the block wrapper carries `data-block-line="<block source line>"`,
//   • the task list carries `data-drop-block="<block source line>"`,
//   • each task row carries `data-task-index="<i>"` (its slot in the block).
// From those we derive the destination block line and the insertion index: the
// slot the task would take if dropped now (before the row whose midpoint the
// pointer is above; after the last row when past them all).
//
// Dropping anywhere on a block that isn't over a specific row (its header, its
// meta line, its padding, an empty block) resolves to an *append* — the whole
// block is a target, not just its task strip — via the `data-block-line`
// fallback. Append is signalled with a large index the caller's insert clamps.

import type { Block, ResolvedTask, Task } from "../../types";
import type { TimelineDrop } from "../../taskDrop";
import {
  dropRange,
  offsetToMinutes,
  type TimelineGeometry,
} from "./layout";

/** A flat item surfaced from DayColumn to WeekView for unscheduled rendering. */
export interface UnscheduledItem {
  block: Block;
  task: ResolvedTask;
}

/** The task being dragged, plus the block it started in. */
export interface TaskDragState {
  owner: Block;
  task: Task;
  // Where to paint the floating ghost (follows the pointer).
  ghostX: number;
  ghostY: number;
  // A short label for the ghost — the task's text.
  label: string;
  // Ctrl/Cmd held → drop a copy instead of moving. Tracked live (set on grab,
  // refreshed on every move) so the user can decide mid-drag; read at drop.
  duplicate: boolean;
  // Option/Alt held → a drop on empty time time-boxes the task (it becomes a
  // checkable block) instead of nesting it in a new block. Tracked like
  // `duplicate`.
  timebox: boolean;
}

/** A checkable block being dragged (grid block DnD). */
export interface BlockDragState {
  block: Block;
  /** The ISO date of the source day — used at drop time to find the source day. */
  sourceDate: string;
  /**
   * The Grid row it was lifted from. A header can show in a row that isn't the
   * block's own (decision 73); a drop back on that row keeps its association.
   */
  sourceRowKey?: string;
  // Where to paint the floating ghost.
  ghostX: number;
  ghostY: number;
  // Ghost label: block title + child count so the user knows what's carried.
  label: string;
  // Ctrl/Cmd held → drop a copy instead of moving (see TaskDragState).
  duplicate: boolean;
}

/** A resolved drop position: which block, and the insertion index within it. */
export interface DropSlot {
  blockLine: number;
  index: number;
}

/**
 * From a pointer event during a drag, find the block-task list under the pointer
 * and the insertion index within it. Returns null when the pointer isn't over
 * any block's task area (a drop there is a no-op).
 *
 * `roots` bounds the search to the canvas element(s) this drag belongs to, so a
 * Week column doesn't hit-test another column's DOM. Pass the canvas element(s);
 * an empty/undefined list searches the whole document (DayView's single canvas).
 */
export function hitTestDropSlot(
  event: PointerEvent,
  roots?: Element[],
): DropSlot | null {
  // elementFromPoint sees the topmost element under the pointer even though the
  // window listener's target is wherever capture put it.
  const el = document.elementFromPoint(event.clientX, event.clientY);
  if (!el) return null;

  const inRoots = (node: HTMLElement) =>
    !roots || roots.length === 0 || roots.some((r) => r.contains(node));

  // Prefer the task strip: hovering it lets us place *between* rows. Its block
  // line comes from `data-drop-block`.
  const list = el.closest<HTMLElement>("[data-drop-block]");
  if (list && inRoots(list)) {
    const blockLine = Number(list.dataset.dropBlock);
    if (Number.isNaN(blockLine)) return null;

    // Walk the task rows; the insertion index is the first row whose vertical
    // midpoint sits below the pointer. Past every row → append.
    const rows = Array.from(
      list.querySelectorAll<HTMLElement>("[data-task-index]"),
    );
    let index = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i]!.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    return { blockLine, index };
  }

  // Fallback: anywhere else on a block (header, meta, padding, or a block with
  // no task strip at all) is a valid target that appends to the end.
  const wrap = el.closest<HTMLElement>("[data-block-line]");
  if (wrap && inRoots(wrap)) {
    const blockLine = Number(wrap.dataset.blockLine);
    if (Number.isNaN(blockLine)) return null;
    return { blockLine, index: APPEND_INDEX };
  }

  return null;
}

// ── Timeline canvases ─────────────────────────────────────────────
//
// Each timeline canvas (the Day view's one, each Week column's) carries its
// date and geometry as data attributes, so any drag — including one that began
// in another view — can tell which day a block belongs to and turn a pointer
// position over empty time into minutes, without importing that view's state:
//
//   data-tl-date="<ISO date>"
//   data-tl-start-hour, data-tl-end-hour, data-tl-hour-height, data-tl-top-pad
//
// Block line numbers are only unique within a day, so the date is what makes a
// `data-block-line` meaningful outside its own column.

function canvasGeometry(canvas: HTMLElement): TimelineGeometry | null {
  const d = canvas.dataset;
  const geo = {
    startHour: Number(d.tlStartHour),
    endHour: Number(d.tlEndHour),
    hourHeight: Number(d.tlHourHeight),
    topPad: Number(d.tlTopPad),
  };
  return Object.values(geo).some(Number.isNaN) ? null : geo;
}

/**
 * Where a task released at this pointer position would land on a timeline: a
 * block (and the slot within it), its Unscheduled list, or a span of empty
 * time. Null when the pointer isn't over any of them.
 *
 * `roots` bounds the search the same way `hitTestDropSlot` does; omit it to
 * accept any canvas in the document (a drag from another view).
 */
export function hitTestTimeline(
  event: PointerEvent,
  roots?: Element[],
): TimelineDrop | null {
  const el = document.elementFromPoint(event.clientX, event.clientY);
  if (!el) return null;
  const inRoots = (node: Element) =>
    !roots || roots.length === 0 || roots.some((r) => r.contains(node));

  // A timeline's Unscheduled list (`data-unscheduled-date`): dropping there
  // takes the task out of its block.
  const inbox = el.closest<HTMLElement>("[data-unscheduled-date]");
  if (inbox && inRoots(inbox)) {
    const date = inbox.dataset.unscheduledDate;
    return date ? { kind: "unscheduled", date } : null;
  }

  const canvas = el.closest<HTMLElement>("[data-tl-date]");
  if (!canvas) return null;
  if (!inRoots(canvas)) return null;
  const date = canvas.dataset.tlDate;
  if (!date) return null;

  const slot = hitTestDropSlot(event, [canvas]);
  if (slot) return { kind: "block", date, ...slot };

  const geo = canvasGeometry(canvas);
  if (!geo) return null;
  const offset = event.clientY - canvas.getBoundingClientRect().top;
  return { kind: "time", date, time: dropRange(offsetToMinutes(offset, geo), geo) };
}

/** A drop on a Grid block group: where it lands, and the row it's in. */
export interface GridGroupDrop {
  drop: TimelineDrop;
  rowKey: string;
}

/**
 * With block grouping on, each block group in a Grid cell (its header and its
 * tasks) is a drop target: dropping a task there nests it in that block, on
 * that day and in that row. The Unscheduled group, and the empty Unscheduled
 * slot a cell shows during a drag, take the task out of its block instead.
 *
 * A group carries `data-grid-drop-date`, plus `data-grid-drop-block` (the
 * block's line) unless it's Unscheduled; the row comes from the cell's
 * `data-grid-row-key`. The drop appends to the block's tasks.
 */
export function hitTestGridGroup(event: PointerEvent): GridGroupDrop | null {
  const el = document.elementFromPoint(event.clientX, event.clientY);
  const group = el?.closest<HTMLElement>("[data-grid-drop-date]");
  if (!group) return null;
  const date = group.dataset.gridDropDate;
  const rowKey = group.closest<HTMLElement>("[data-grid-row-key]")?.dataset.gridRowKey;
  if (!date || !rowKey) return null;
  const line = group.dataset.gridDropBlock;
  if (line === undefined) return { drop: { kind: "unscheduled", date }, rowKey };
  const blockLine = Number(line);
  if (Number.isNaN(blockLine)) return null;
  return { drop: { kind: "block", date, blockLine, index: APPEND_INDEX }, rowKey };
}

// A slot index past any real list length: the caller's insert clamps it to an
// append, and the block's drop indicator reads `index >= chips.length` → shows
// the trailing marker.
export const APPEND_INDEX = Number.MAX_SAFE_INTEGER;

/**
 * The DOM contract for grid cells, emitted by GridView:
 *   • the datacell wrapper carries `data-grid-date="<ISO date>"` and
 *     `data-grid-row-key="<row.key>"`,
 *   • each task row carries `data-task-index="<i>"`.
 */
export interface GridDropSlot {
  date: string;
  /** The row key — used by GridView to look up the row's association. */
  rowKey: string;
  /** Insertion index among the cell's tasks (clamped by the caller). */
  index: number;
}

/**
 * From a pointer event during a grid task drag, find the cell and insertion
 * index under the pointer. Returns null when the pointer isn't over any cell.
 */
export function hitTestGridCell(event: PointerEvent): GridDropSlot | null {
  const el = document.elementFromPoint(event.clientX, event.clientY);
  if (!el) return null;

  const cell = el.closest<HTMLElement>("[data-grid-date]");
  if (!cell) return null;
  const date = cell.dataset.gridDate;
  const rowKey = cell.dataset.gridRowKey;
  if (!date || !rowKey) return null;

  // Grid drops are order-agnostic: always append to the target cell.
  return { date, rowKey, index: APPEND_INDEX };
}
