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
// Boundaries mirror the parser exactly (see `parser.ts`):
//   - the section starts on the line after the first `#{1,6} Schedule` heading
//   - it ends at the next heading line (`#{1,6} …`), or end-of-file
// so the range this module replaces is the same range the parser reads.
//
// Blocks are kept ordered by time on every write, matching spec §4.1 ("move
// rewrites the file so that entries stay ordered by time"). Untimed blocks
// (the Unscheduled inbox) are pinned to the end in their existing order.

import type { TFile, Vault } from "obsidian";
import { serialize } from "./serializer";
import type { Block, SourceRef, Task, TaskStatus, TimeRange } from "./types";

// Matches the parser's heading regexes. `SCHEDULE_HEADING` finds the section;
// `ANY_HEADING` finds where it ends.
const SCHEDULE_HEADING = /^#{1,6}\s+Schedule\s*$/;
const ANY_HEADING = /^#{1,6}\s/;

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
export async function writeSchedule(
  vault: Vault,
  file: TFile,
  blocks: Block[],
): Promise<void> {
  const ordered = sortForWrite(blocks);
  const section = serialize(ordered); // includes the "## Schedule" heading

  await vault.process(file, (text) => spliceSection(text, section));
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
 * Rename a block. A checkable block's colocated task text mirrors the title (by
 * construction they're the same string), so the task text is renamed in step to
 * keep the two from drifting apart across a serialize round-trip.
 */
export function setBlockTitle(
  blocks: Block[],
  target: Block,
  title: string,
): Block[] {
  return blocks.map((b) => {
    if (!isOwner(b, target)) return b;
    return {
      ...b,
      title,
      ...(b.task ? { task: { ...b.task, text: title } } : {}),
    };
  });
}

/**
 * Cycle a checkable block's colocated task status. No-op on a block without a
 * checkbox — adding a checkbox is a separate action, not a status change.
 */
export function setBlockStatus(
  blocks: Block[],
  target: Block,
  status: TaskStatus,
): Block[] {
  return blocks.map((b) => {
    if (!isOwner(b, target) || !b.task) return b;
    return { ...b, task: { ...b.task, status } };
  });
}

// ─── task operations ───────────────────────────────────────────
//
// A task lives either as a block's colocated `task` (sharing the block line) or
// as an entry in `block.tasks`. These transforms take the owning block and the
// target task and return a fresh `Block[]` with just that task changed.
//
// Matching is by source location, not object identity. The render layer hands
// tasks out as resolved clones (`resolveBlocks` spreads each task), so the
// object the caller passes back is never the same reference stored in `blocks`.
// A `SourceRef` (path + line) is stable across that clone and uniquely names a
// task line, so it's the handle every match uses.

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

/** Replace a task's fields via `patch`, returning a new `Block[]`. */
function patchTask(
  blocks: Block[],
  owner: Block,
  target: Task,
  patch: (task: Task) => Task,
): Block[] {
  return blocks.map((b) => {
    if (!isOwner(b, owner)) return b;

    // Colocated task: it *is* the block's checkbox, so patch `b.task`.
    if (b.task && sameSource(b.task.source, target.source)) {
      return { ...b, task: patch(b.task) };
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
 * checkbox, so deleting it drops the `task` field (the block itself stays).
 */
export function deleteTask(blocks: Block[], owner: Block, target: Task): Block[] {
  return blocks.map((b) => {
    if (!isOwner(b, owner)) return b;
    if (b.task && sameSource(b.task.source, target.source)) {
      const { task: _removed, ...rest } = b;
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

// ─── section splicing ──────────────────────────────────────────

/**
 * Replace the Schedule section of `text` with `section` (which is itself a
 * complete "## Schedule …" block with a trailing newline). If there is no
 * Schedule section, append one after a blank-line separator.
 *
 * Returns the full new file text.
 */
function spliceSection(text: string, section: string): string {
  const lines = text.split(/\r?\n/);
  const bounds = sectionBounds(lines);

  if (!bounds) {
    // No section yet: append, keeping a blank line between existing content and
    // the new heading (unless the file is empty).
    const trimmed = text.replace(/\s*$/, "");
    const prefix = trimmed.length > 0 ? trimmed + "\n\n" : "";
    return prefix + section;
  }

  const before = lines.slice(0, bounds.headingLine);
  const after = lines.slice(bounds.end);

  // `section` ends with a newline; splitting it drops the trailing empty entry.
  const sectionLines = section.replace(/\n$/, "").split("\n");

  // Keep a single blank line between the section and whatever heading follows,
  // so the rewrite doesn't butt the section straight up against the next "##".
  if (after.length > 0 && ANY_HEADING.test(after[0] ?? "")) {
    sectionLines.push("");
  }

  return [...before, ...sectionLines, ...after].join("\n");
}

interface SectionBounds {
  headingLine: number; // index of the "## Schedule" line
  end: number; // index one past the last line of the section
}

/**
 * Find the Schedule section's line range: from its heading through the line
 * before the next heading (or EOF).
 */
function sectionBounds(lines: string[]): SectionBounds | undefined {
  let headingLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SCHEDULE_HEADING.test(lines[i] ?? "")) {
      headingLine = i;
      break;
    }
  }
  if (headingLine === -1) return undefined;

  let end = lines.length;
  for (let i = headingLine + 1; i < lines.length; i++) {
    if (ANY_HEADING.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }

  return { headingLine, end };
}

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
