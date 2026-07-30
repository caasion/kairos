// Kairos markdown serializer
//
// The inverse of `parser.ts`: turns a Kairos `Block[]` back into the markdown
// lines of a daily-note "## Schedule" section.
//
// Round-trip invariant:
//
//   parseSchedule(serialize(blocks), path)  ≡  blocks
//
// where `≡` compares structure only — `SourceRef.line`/`path` are re-derived by
// the parser from the emitted text, so they are excluded from the comparison.
//
// Line grammar produced (mirrors the parser's, metadata right of the title):
//
//   <indent> "- " [ "[" status "] " ] [ HH:MM " - " HH:MM " " ] title
//            [ " [" Assoc "]" ] [ " (" tag ")" ]
//
// Associations serialize as `[Project]` or `[D:Domain]`; a checkbox on a block
// line comes from that block's colocated `task`. Nested tasks are indented one
// tab under their block.
//
// Fidelity note: the parser strips a trailing `[...]` or `(...)` off any title,
// so a title/text that itself *ends* with a bracketed or parenthesised token
// cannot round-trip. That is a parser limitation, not one this serializer can
// paper over; such titles are emitted verbatim.

import type { Association, Block, Task, TaskStatus } from "./types";

// ─── configuration ─────────────────────────────────────────────

const SCHEDULE_HEADING = "## Schedule";
const INDENT = "\t"; // one nesting step for tasks under a block

// ─── public API ────────────────────────────────────────────────

/**
 * Serialize blocks into a full Schedule section, heading included.
 *
 * @param blocks  blocks in document order
 * @returns       markdown text ending with a trailing newline
 */
function serialize(blocks: Block[]): string {
  const lines: string[] = [SCHEDULE_HEADING, ""];
  for (const block of blocks) {
    for (const line of serializeBlock(block)) lines.push(line);
  }
  return lines.join("\n") + "\n";
}

export { serialize, serializeBlock, serializeTask };

// ─── block / task rendering ────────────────────────────────────

/** Render a block and its tasks as one or more markdown lines. */
function serializeBlock(block: Block): string[] {
  const lines: string[] = [];

  // The block line. `status` (the checkbox) is present iff the block is
  // checkable; `metadata` is the trailing paren note. Both live directly on the
  // block now, so there is a single source for the line's text — no title/text
  // pair to drift apart.
  lines.push(
    "- " +
      renderBody({
        status: block.status,
        time: block.time,
        title: block.title,
        assoc: block.assoc,
        metadata: block.metadata,
      }),
  );

  // Nested tasks, one indent step deeper.
  for (const task of block.tasks) {
    lines.push(INDENT + "- " + serializeTask(task));
  }

  return lines;
}

/** Render a nested task's body (the part after "- "). */
function serializeTask(task: Task): string {
  return renderBody({
    status: task.status,
    title: task.text,
    assoc: task.assoc,
    metadata: task.metadata,
  });
}

// ─── body assembly ─────────────────────────────────────────────

interface Body {
  status?: TaskStatus;
  time?: { start: number; end: number };
  title: string;
  assoc?: Association;
  metadata?: string;
}

/**
 * Assemble the text after the list marker: optional checkbox, optional time
 * range, title, then trailing metadata in the order the parser peels off
 * (assoc before the paren note, right-to-left).
 */
function renderBody(b: Body): string {
  let out = "";
  if (b.status !== undefined) out += `[${b.status}] `;
  if (b.time) out += `${formatTime(b.time.start)} - ${formatTime(b.time.end)} `;
  out += b.title;
  if (b.assoc) out += ` [${formatAssoc(b.assoc)}]`;
  if (b.metadata !== undefined) out += ` (${b.metadata})`;
  return out;
}

/** `[Project]` → `Project`; `[D:Domain]` → `D:Domain`. */
function formatAssoc(assoc: Association): string {
  return assoc.kind === "domain" ? `D:${assoc.id}` : assoc.id;
}

/** Minutes-since-midnight → `HH:MM`, zero-padded. */
function formatTime(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${pad(hh)}:${pad(mm)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
