// Kairos write-back layer
//
// The only module that mutates daily-note files. Everything above it (the
// timeline interactions) works on in-memory `Block[]` and hands a finished
// array here to persist. Writing is a whole-section splice, not a per-line
// edit: we re-serialize the entire Schedule section and drop it back into the
// file between its surrounding content. That keeps this layer trivially
// correct — there is exactly one code path from `Block[]` to disk, shared by
// move, resize, create, and delete.
//
// Boundaries mirror the parser exactly: both the splice (in `section.ts`) and
// the parser locate the section by the configured heading and end it at the
// next heading (or EOF), so the range this module replaces is the same range
// the parser reads.
//
// Blocks are kept ordered by time on every write, matching spec §4.1 ("move
// rewrites the file so that entries stay ordered by time"). Untimed blocks
// (the Unscheduled inbox) are pinned to the end in their existing order.

import type { TFile, Vault } from "obsidian";
import { serialize } from "./serializer";
import { DEFAULT_HEADING, spliceSection } from "./section";
import type {
  Association,
  Block,
  SourceRef,
  Task,
  TaskStatus,
  TimeRange,
} from "./types";

const DEFAULT_BLOCK_TITLE = "New block";

// ─── public API ────────────────────────────────────────────────

/**
 * Persist a full set of blocks as the note's Schedule section.
 *
 * The blocks are re-serialized and spliced over the existing section, leaving
 * frontmatter, other headings, and surrounding prose untouched. If the note has
 * no Schedule section yet, one is appended.
 *
 * Ordering is normalized here (timed blocks by start time, untimed pinned to
 * the end) so callers never have to keep the array sorted themselves.
 */
export interface WriteResult {
  // The normalized block order actually written. A caller doing an optimistic
  // in-memory update should adopt this, not its pre-sort input, so memory and
  // disk stay identical (no correcting re-render).
  blocks: Block[];
  // The full new file text. A caller can cache this and compare it against the
  // `vault.on("modify")` echo of this very write, to skip reparsing its own
  // change while still reacting to genuinely external edits.
  text: string;
}

export async function writeSchedule(
  vault: Vault,
  file: TFile,
  blocks: Block[],
  heading: string = DEFAULT_HEADING,
): Promise<WriteResult> {
  const ordered = sortForWrite(blocks);
  const section = serialize(ordered, heading); // the heading block, trailing \n

  let written = "";
  await vault.process(file, (text) => {
    written = spliceSection(text, section, heading);
    return written;
  });

  return { blocks: ordered, text: written };
}

// ─── block operations ──────────────────────────────────────────
//
// These are pure array transforms — they never touch the file. The caller
// applies one (or several) and then hands the result to `writeSchedule`. Kept
// pure so the timeline can preview an operation in local state and only persist
// on drop.

/** Return a copy of `blocks` with `target`'s time replaced. */
export function retimeBlock(
  blocks: Block[],
  target: Block,
  time: TimeRange,
): Block[] {
  return blocks.map((b) => (isOwner(b, target) ? { ...b, time } : b));
}

/**
 * Retime several blocks at once (used when a multi-selection is dragged as a
 * group). `times` maps each target block to its new range.
 */
export function retimeBlocks(
  blocks: Block[],
  times: Map<Block, TimeRange>,
): Block[] {
  return blocks.map((b) => {
    const time = times.get(b);
    return time ? { ...b, time } : b;
  });
}

// ─── block field edits ─────────────────────────────────────────

/**
 * Rename a block. The title is the block line's text; a checkable block has no
 * separate task text to keep in sync, so this is a single-field edit.
 */
export function setBlockTitle(
  blocks: Block[],
  target: Block,
  title: string,
): Block[] {
  return blocks.map((b) => (isOwner(b, target) ? { ...b, title } : b));
}

/**
 * Set a checkable block's status. No-op on a block without a checkbox — adding a
 * checkbox is a separate action, not a status change.
 */
export function setBlockStatus(
  blocks: Block[],
  target: Block,
  status: TaskStatus,
): Block[] {
  return blocks.map((b) => {
    if (!isOwner(b, target) || b.status === undefined) return b;
    return { ...b, status };
  });
}

// ─── task operations ───────────────────────────────────────────
//
// A task is either a block's colocated checkbox (its `source` is the block's
// own line) or an entry in `block.tasks`. These transforms take the owning
// block and the target task and return a fresh `Block[]` with just that task
// changed.
//
// Matching is by source location, not object identity. The render layer hands
// tasks out as resolved clones (`resolveBlocks` synthesizes/spreads each task),
// so the object the caller passes back is never the same reference stored in
// `blocks`. A `SourceRef` (path + line) is stable across that clone and
// uniquely names a task line, so it's the handle every match uses.
//
// The colocated task has no separate storage: its fields *are* the block's
// (`title`↔`text`, `status`, `assoc`, `metadata`). Patching it therefore folds
// the patched task fields back onto the block, keeping one source of truth.

/** True if two source refs name the same file line. */
function sameSource(a: SourceRef, b: SourceRef): boolean {
  return a.line === b.line && a.path === b.path;
}

/**
 * Match a block by owner. Same clone problem as tasks: a block handed back from
 * a preview/resolve pass is a spread copy, so compare by source, not identity.
 */
function isOwner(block: Block, owner: Block): boolean {
  return sameSource(block.source, owner.source);
}

/** A checkable block viewed as its colocated task. */
function blockAsTask(b: Block): Task {
  return {
    source: b.source,
    text: b.title,
    status: b.status as TaskStatus,
    ...(b.assoc ? { assoc: b.assoc } : {}),
    ...(b.metadata ? { metadata: b.metadata } : {}),
  };
}

/** Fold patched colocated-task fields back onto the block. */
function foldTaskOntoBlock(b: Block, t: Task): Block {
  return {
    ...b,
    title: t.text,
    status: t.status,
    ...(t.assoc ? { assoc: t.assoc } : { assoc: undefined }),
    ...(t.metadata !== undefined
      ? { metadata: t.metadata }
      : { metadata: undefined }),
  };
}

/** Replace a task's fields via `patch`, returning a new `Block[]`. */
function patchTask(
  blocks: Block[],
  owner: Block,
  target: Task,
  patch: (task: Task) => Task,
): Block[] {
  return blocks.map((b) => {
    if (!isOwner(b, owner)) return b;

    // Colocated task: the target shares the block's line, so patch the block's
    // own fields (there is no nested task object).
    if (b.status !== undefined && sameSource(b.source, target.source)) {
      return foldTaskOntoBlock(b, patch(blockAsTask(b)));
    }
    // Otherwise a nested task in `b.tasks`.
    return {
      ...b,
      tasks: b.tasks.map((t) =>
        sameSource(t.source, target.source) ? patch(t) : t,
      ),
    };
  });
}

/** Set a task's status (open / done / half-done / cancelled). */
export function setTaskStatus(
  blocks: Block[],
  owner: Block,
  target: Task,
  status: TaskStatus,
): Block[] {
  return patchTask(blocks, owner, target, (t) => ({ ...t, status }));
}

/** Replace a task's description text. */
export function setTaskText(
  blocks: Block[],
  owner: Block,
  target: Task,
  text: string,
): Block[] {
  return patchTask(blocks, owner, target, (t) => ({ ...t, text }));
}

/**
 * Remove a task. A nested task is filtered out of its block's `tasks`. A
 * colocated task can't be removed on its own without also removing the block's
 * checkbox, so deleting it drops the block's `status`/`metadata` (the block
 * itself, its title and time, stays).
 */
export function deleteTask(blocks: Block[], owner: Block, target: Task): Block[] {
  return blocks.map((b) => {
    if (!isOwner(b, owner)) return b;
    if (b.status !== undefined && sameSource(b.source, target.source)) {
      const { status: _s, metadata: _m, ...rest } = b;
      return { ...rest };
    }
    return {
      ...b,
      tasks: b.tasks.filter((t) => !sameSource(t.source, target.source)),
    };
  });
}

/** Return a copy of `blocks` with `target` removed. */
export function deleteBlock(blocks: Block[], target: Block): Block[] {
  return blocks.filter((b) => !isOwner(b, target));
}

// ─── unscheduled inbox ─────────────────────────────────────────
//
// The Grid view creates tasks that are associated but NOT scheduled (spec §5:
// "Tasks will not be automatically scheduled — moved to Unscheduled"). A new
// task therefore lands in the day's reserved Unscheduled block, and the row's
// association is written *explicitly* onto the task line (materialize-on-move,
// §4.3 / §2.2: an association is display-only only while inherited; a task the
// user files under a project/domain in the grid carries it literally).

const UNSCHEDULED_TITLE = "Unscheduled";

/** The day's Unscheduled inbox block, if it has one. */
function findUnscheduled(blocks: Block[]): Block | undefined {
  return blocks.find(
    (b) => b.time === undefined && b.title === UNSCHEDULED_TITLE,
  );
}

/**
 * Append a new task to the day's Unscheduled block, creating that block if the
 * day doesn't have one yet. `assoc` (the grid row's owner) is written onto the
 * task explicitly so the plain text stays literally true — a grid-filed task is
 * never merely inheriting.
 *
 * Pure: returns a fresh `Block[]`; the caller persists via `applyDayEdit`.
 * `line` is a throwaway negative handle (like `makeBlock`), unique per unsaved
 * task so keyed rendering doesn't collide before the reparse re-derives lines.
 */
export function addTaskToUnscheduled(
  blocks: Block[],
  path: string,
  text: string,
  assoc: Association | undefined,
  line = -1,
): Block[] {
  const task: Task = {
    source: { path, line },
    text,
    status: " ",
    ...(assoc ? { assoc } : {}),
  };
  return insertIntoUnscheduled(blocks, task, path, line - 1);
}

/**
 * Append `task` to the day's Unscheduled block, creating that block if absent.
 * `inboxLine` is the throwaway negative line for a freshly-created inbox block
 * (only used when no inbox exists yet). Shared by `addTaskToUnscheduled` (new
 * task) and `unnestTask` (moved task).
 */
function insertIntoUnscheduled(
  blocks: Block[],
  task: Task,
  path: string,
  inboxLine: number,
): Block[] {
  const existing = findUnscheduled(blocks);
  if (existing) {
    return blocks.map((b) =>
      isOwner(b, existing) ? { ...b, tasks: [...b.tasks, task] } : b,
    );
  }

  // No inbox yet: create one and drop the task in. `sortForWrite` pins untimed
  // blocks to the end, so its position in the array here doesn't matter.
  const inbox: Block = {
    source: { path, line: inboxLine },
    title: UNSCHEDULED_TITLE,
    tasks: [task],
    scheduled: false,
  };
  return [...blocks, inbox];
}

/**
 * Unnest a task: move it out of its (timed) block into the day's Unscheduled
 * block. This is the Grid view's one time-dimension write — you *schedule*
 * blocks, not tasks, so a task loses its time by leaving the block, never by a
 * time edit of its own.
 *
 * Materialize-on-move (spec §4.3): a task that was only *inheriting* its block's
 * association would become genuinely Unassociated once it leaves the block (an
 * Unscheduled block has no association to inherit). To keep the plain text
 * literally true and the task in the same grid row, the inherited association is
 * written explicitly onto the moved task. A task with its own explicit
 * association keeps it unchanged.
 *
 * No-op unless `owner` is a real timed block holding `target` as a nested task:
 * a colocated task (the block's own checkbox) is part of a *block*, which is not
 * unnestable — remove the block in the timeline instead. Pure; caller persists.
 */
export function unnestTask(
  blocks: Block[],
  owner: Block,
  target: Task,
  path: string,
): Block[] {
  const source = blocks.find((b) => isOwner(b, owner));
  if (!source) return blocks;

  // Only a genuinely nested task can unnest. A colocated task shares the block's
  // own line (it *is* the block's checkbox), so bail if the target is that.
  const nested = source.tasks.find((t) => sameSource(t.source, target.source));
  if (!nested) return blocks;

  // Materialize: keep an explicit assoc; otherwise inherit the block's onto it.
  const assoc = nested.assoc ?? source.assoc;
  const moved: Task = { ...nested, ...(assoc ? { assoc } : {}) };

  // Remove from the source block, then insert into Unscheduled.
  const without = blocks.map((b) =>
    isOwner(b, source)
      ? { ...b, tasks: b.tasks.filter((t) => !sameSource(t.source, target.source)) }
      : b,
  );
  return insertIntoUnscheduled(without, moved, path, target.source.line - 1);
}

// ─── nest a task under a block ─────────────────────────────────
//
// CORE LOGIC — flagged for review. Re-parent a task from wherever it lives now
// (a timed block, the Unscheduled inbox, or a checkable block viewed as its own
// colocated task) into `target` block, optionally at a chosen slot among that
// block's existing tasks. This is the timeline's "nest" gesture — the inverse
// of `unnestTask` — reached from the task's menu, its context-menu picker, and
// drag-and-drop between blocks. It is a pure `Block[]` transform so the timeline
// can commit it the same optimistic way every other edit does.
//
// Materialize-on-move (spec §4.3 / §2.2): a task's *inherited* association is
// display-only. The moment it changes owners it would silently re-inherit the
// destination block's association (or none), so we pin the association it had —
// its explicit one, or the one inherited from its old owner — onto the task line
// before it moves. A task with its own explicit association keeps it verbatim.
// Result: nesting never changes a task's owner unless the user meant it to.
//
// Two source shapes are handled:
//   • a genuine nested task, removed from its old block's `tasks`;
//   • a colocated task (a checkable block's own line). That task *is* a block,
//     so it can't be lifted off its line — nesting it is a no-op. Convert the
//     block first (or move the block), then nest.
// Nesting into the same block it already lives in is allowed: it becomes a pure
// reorder (remove then re-insert at `index`).

/**
 * Move `target` (currently owned by `sourceOwner`) into `destination` block,
 * inserting at `index` among the destination's existing tasks (clamped; omit or
 * pass a large value to append). Returns a fresh `Block[]`; the caller persists.
 *
 * The inherited-or-explicit association is materialized onto the task so its
 * owner survives the move (see the block comment above). No-op if the source
 * task is a colocated block line, or either block can't be found.
 */
export function nestTaskUnderBlock(
  blocks: Block[],
  sourceOwner: Block,
  target: Task,
  destination: Block,
  index = Number.MAX_SAFE_INTEGER,
): Block[] {
  const source = blocks.find((b) => isOwner(b, sourceOwner));
  const dest = blocks.find((b) => isOwner(b, destination));
  if (!source || !dest) return blocks;

  // A colocated task is the block's own checkbox line — it isn't a liftable
  // nested task, so there is nothing to re-parent.
  if (source.status !== undefined && sameSource(source.source, target.source)) {
    return blocks;
  }

  const nested = source.tasks.find((t) => sameSource(t.source, target.source));
  if (!nested) return blocks;

  // Materialize: keep an explicit assoc, else inherit the *source* block's onto
  // the task so its owner doesn't change by moving under a different block.
  const assoc = nested.assoc ?? source.assoc;
  const moved: Task = { ...nested, ...(assoc ? { assoc } : {}) };

  const sameBlock = isOwner(source, dest);

  return blocks.map((b) => {
    // Remove from the source block first (in the same-block case this drains the
    // slot the task used to occupy, so `index` counts against the remainder).
    if (isOwner(b, source)) {
      const remaining = b.tasks.filter(
        (t) => !sameSource(t.source, target.source),
      );
      if (!sameBlock) return { ...b, tasks: remaining };
      // Same block: insert into the freshly-drained list at the clamped slot.
      const at = Math.max(0, Math.min(index, remaining.length));
      return { ...b, tasks: [...remaining.slice(0, at), moved, ...remaining.slice(at)] };
    }
    if (isOwner(b, dest)) {
      const at = Math.max(0, Math.min(index, b.tasks.length));
      return { ...b, tasks: [...b.tasks.slice(0, at), moved, ...b.tasks.slice(at)] };
    }
    return b;
  });
}

// ─── cross-day task move ───────────────────────────────────────

export interface CrossDayTaskMove {
  /** The source day's blocks, with the task removed from its owner. */
  from: Block[];
  /** The target day's blocks, with the task appended to Unscheduled. */
  to: Block[];
}

/**
 * Move a task from one day's blocks into another day's Unscheduled block.
 * Used by the Grid drag-to-reschedule gesture. Same materialize-on-move rule
 * as `unnestTask`: the inherited or explicit association is stamped onto the
 * task so it stays in the same grid row after the move.
 *
 * Colocated tasks (a checkable block's own line) are a no-op — they are blocks,
 * not liftable tasks. Pure; caller persists both days via `applyCrossDayMove`.
 */
export function moveTaskAcrossDays(
  fromBlocks: Block[],
  toBlocks: Block[],
  sourceOwner: Block,
  target: Task,
  toPath: string,
  toInboxLine: number,
): CrossDayTaskMove {
  const source = fromBlocks.find((b) => isOwner(b, sourceOwner));
  if (!source) return { from: fromBlocks, to: toBlocks };

  // Colocated task = the block's own checkbox line; not liftable.
  if (source.status !== undefined && sameSource(source.source, target.source)) {
    return { from: fromBlocks, to: toBlocks };
  }

  const nested = source.tasks.find((t) => sameSource(t.source, target.source));
  if (!nested) return { from: fromBlocks, to: toBlocks };

  // Materialize-on-move: pin explicit or inherited association.
  const assoc = nested.assoc ?? source.assoc;
  const moved: Task = {
    ...nested,
    source: { path: toPath, line: toInboxLine },
    ...(assoc ? { assoc } : {}),
  };

  const from = fromBlocks.map((b) =>
    isOwner(b, source)
      ? { ...b, tasks: b.tasks.filter((t) => !sameSource(t.source, target.source)) }
      : b,
  );
  const to = insertIntoUnscheduled(toBlocks, moved, toPath, toInboxLine - 1);
  return { from, to };
}

// ─── cross-day block move ──────────────────────────────────────
//
// CORE LOGIC — flagged for review. Moving a block from one daily note to
// another is the only write that touches two files, so it can't reuse the
// single-array transforms above. It is expressed here as a *pure* transform
// over both days' block arrays; the caller persists both notes atomically
// (see KairosIndex.applyCrossDayMove).
//
// Materialize-on-move (spec §4.3) is about a *task* leaving the block it
// inherits from. A whole-block move carries the block's own `assoc` and all
// its child tasks together, so every child still inherits the same owner on
// the other day — there is nothing to materialize. The block's association is
// already explicit on the block line, so it survives the move verbatim.
//
// The moved block's `source` is repointed at the target path with a throwaway
// line; the target note's reparse re-derives the real line, exactly like
// `makeBlock`. Its `time` may be replaced (a drag can drop it at a new hour on
// the destination day); pass the same range to move it to the same time.

export interface CrossDayMove {
  /** The source day's blocks, with the moved block removed. */
  from: Block[];
  /** The target day's blocks, with the moved block inserted. */
  to: Block[];
}

/**
 * Move `target` out of `fromBlocks` (a source day) and into `toBlocks` (a
 * target day), optionally retiming it. Returns fresh arrays for both days;
 * neither input is mutated. `time` defaults to the block's current range.
 *
 * `toPath` is the destination note path, stamped onto the moved block's source
 * so it (and its tasks) route to the right file until the next reparse.
 */
export function moveBlockAcrossDays(
  fromBlocks: Block[],
  toBlocks: Block[],
  target: Block,
  toPath: string,
  time?: TimeRange,
): CrossDayMove {
  const from = fromBlocks.filter((b) => !isOwner(b, target));

  // Repoint the moved block (and its child tasks) at the destination file with
  // throwaway lines; the reparse on write re-derives real lines.
  const moved: Block = {
    ...target,
    source: { path: toPath, line: -1 },
    ...(time ? { time } : {}),
    tasks: target.tasks.map((t, i) => ({
      ...t,
      source: { path: toPath, line: -(i + 2) },
    })),
  };

  return { from, to: [...toBlocks, moved] };
}

/** Return a copy of `blocks` with every block in `targets` removed. */
export function deleteBlocks(
  blocks: Block[],
  targets: Iterable<Block>,
): Block[] {
  const lines = new Set<string>();
  for (const t of targets) lines.add(`${t.source.path}:${t.source.line}`);
  return blocks.filter((b) => !lines.has(`${b.source.path}:${b.source.line}`));
}

/**
 * Build a fresh timed block with a placeholder title. Not spliced into an array
 * here — the caller appends it and persists — so callers stay in control of
 * ordering (which `writeSchedule` normalizes anyway).
 *
 * `source` is a throwaway handle; the parser re-derives the real line on the
 * next read. It only needs to be unique enough for keyed rendering until then —
 * so the caller passes a distinct negative `line` per unsaved block. Two blocks
 * created before the reparse must NOT share a line, or the keyed `{#each}` that
 * renders them collides and stops reconciling (a frozen timeline). Defaults to
 * -1 for the common single-create case.
 */
export function makeBlock(
  time: TimeRange,
  path: string,
  title = DEFAULT_BLOCK_TITLE,
  line = -1,
): Block {
  return {
    source: { path, line },
    title,
    tasks: [],
    scheduled: true,
    time,
  };
}

// Section splicing lives in section.ts (shared with the index write path).

// ─── ordering ──────────────────────────────────────────────────

/**
 * Sort blocks for writing: timed blocks first, ascending by start (then end),
 * then untimed blocks in their original relative order. Stable so equal-start
 * blocks keep their prior arrangement.
 */
function sortForWrite(blocks: Block[]): Block[] {
  const timed: Block[] = [];
  const untimed: Block[] = [];
  for (const b of blocks) (b.time ? timed : untimed).push(b);

  timed.sort((a, b) => {
    const at = a.time as TimeRange;
    const bt = b.time as TimeRange;
    return at.start - bt.start || at.end - bt.end;
  });

  return [...timed, ...untimed];
}
