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
//   • the task list carries `data-drop-block="<block source line>"`,
//   • each task row carries `data-task-index="<i>"` (its slot in the block).
// From those we derive the destination block line and the insertion index: the
// slot the task would take if dropped now (before the row whose midpoint the
// pointer is above; after the last row when past them all).

import type { Block, Task } from "../../types";

/** The task being dragged, plus the block it started in. */
export interface TaskDragState {
  owner: Block;
  task: Task;
  // Where to paint the floating ghost (follows the pointer).
  ghostX: number;
  ghostY: number;
  // A short label for the ghost — the task's text.
  label: string;
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

  const list = el.closest<HTMLElement>("[data-drop-block]");
  if (!list) return null;
  if (roots && roots.length > 0 && !roots.some((r) => r.contains(list))) {
    return null;
  }

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
