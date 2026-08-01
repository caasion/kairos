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
import type { Block, SourceRef, Task, TaskStatus, TimeRange } from "./types";

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
 * next read. It only needs to be unique enough for keyed rendering until then.
 */
export function makeBlock(
  time: TimeRange,
  path: string,
  title = DEFAULT_BLOCK_TITLE,
): Block {
  return {
    source: { path, line: -1 },
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
