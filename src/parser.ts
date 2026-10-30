// Kairos markdown parser
//
// Converts a daily-note "## Schedule" section into Kairos `Block[]`.
//
// Grammar (per line, all list items under the Schedule heading):
//
//   <indent> "- " [ "[" status "] " ] [ HH:MM " - " HH:MM " " ] title
//
//   title may carry trailing metadata, stripped in this order (right to left):
//     [Assoc]      one or more association tags: [Project], [D:Domain]
//     (paren note)  a single trailing parenthesised note -> Task.tag
//
// Top-level list items are blocks. Items indented under a block are that
// block's tasks when they carry a checkbox, and its notes when they don't
// (kept verbatim). A block has no status, so a block line is written without a
// checkbox. A legacy top-level line that has one is from when blocks could be
// checked:
//   • a timed one ("- [x] 07:00 - 08:00 Gym") reads as a plain block holding
//     one task first in its list: the block's title, the checkbox's status, no
//     association or metadata of its own (it inherits the block's). That task
//     shares the block's source line until the next write, which splits it
//     into the two-line form ("- 07:00 - 08:00 Gym" / "\t- [x] Gym");
//   • an untimed one ("- [ ] Call mom [D:Home]") reads as a task in the day's
//     Unscheduled list, as the same line does in Routines.md, with the items
//     nested under it after it. An untimed block other than Unscheduled shows
//     only through its tasks, so a same-named block would be left behind,
//     empty and out of reach, once the task moved on. When the day has no
//     Unscheduled line, the parser makes that block and gives it the heading's
//     line, which no block or task has.
//
// The parser is deliberately literal: it records associations exactly as
// written (a task assoc that duplicates its block's is kept, not dropped) and
// does not resolve inheritance — that is left to the resolution layer.

import type {
  Association,
  Block,
  SourceRef,
  Task,
  TaskStatus,
  TimeRange,
} from "./types";
import { DEFAULT_HEADING, headingMatcher } from "./section";

// ─── configuration ─────────────────────────────────────────────

const UNSCHEDULED_TITLE = /^unscheduled$/i;

// A list item, capturing indentation, optional checkbox, and the remainder.
//   group 1: leading whitespace (indent)
//   group 2: checkbox status char, if present
//   group 3: the rest of the line (title + inline time + metadata)
const LIST_ITEM = /^([ \t]*)[-*+]\s+(?:\[(.)\]\s+)?(.*)$/;

// Leading "HH:MM - HH:MM " time range.
const TIME_RANGE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(.*)$/;

// Midnight at the end of the day. The timeline runs to 24:00 by default, so a
// block may end here; the serializer writes it as "24:00".
const MIDNIGHT = 24 * 60;

// A bare "HH:MM" clock value.
const CLOCK = /^(\d{1,2}):(\d{2})$/;

// A typed "HH:MM - HH:MM" range: a hyphen, en dash or em dash between the two
// times, spaces around it optional.
const RANGE_TEXT = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/;

// Trailing "[...]" association tag (matched repeatedly, right to left).
const TRAILING_ASSOC = /\s*\[([^\]]+)\]\s*$/;

// Trailing "(...)" note -> Task.tag.
const TRAILING_PAREN = /\s*\(([^)]*)\)\s*$/;

// ─── public API ────────────────────────────────────────────────

/**
 * Parse the Schedule section of a daily note into blocks.
 *
 * @param markdown  full note text
 * @param path      note path, recorded in every SourceRef
 * @returns         the blocks in document order (empty if no Schedule section)
 */
function parseSchedule(
  markdown: string,
  path: string,
  heading: string = DEFAULT_HEADING,
): Block[] {
  const lines = markdown.split(/\r?\n/);

  const start = findScheduleStart(lines, heading);
  if (start === -1) return [];

  const blocks: Block[] = [];
  let current: Block | undefined;
  let blockIndent = 0;
  // Untimed legacy checkbox lines and the items under them, for the inbox.
  let loose: Block | undefined;

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i] ?? "";

    // A non-indented heading ends the section.
    if (/^#{1,6}\s/.test(raw)) break;

    const item = LIST_ITEM.exec(raw);
    if (!item) continue; // blank lines, prose, etc. — skip, stay in section

    const indent = indentWidth(item[1] ?? "");
    const status = item[2];
    const body = item[3] ?? "";
    const source: SourceRef = { path, line: i };

    // Nested item under an open block → a task of that block, or a note when
    // it has no checkbox.
    if (current && indent > blockIndent) {
      if (status === undefined) {
        (current.notes ??= []).push({ text: body, at: current.tasks.length });
      } else {
        current.tasks.push(parseTask(body, status, source));
      }
      continue;
    }

    // Otherwise this item starts a new block. A legacy checkbox on it becomes
    // the block's first task, or a task for the inbox (see the header).
    blockIndent = indent;
    const block = parseBlock(body, source);
    if (status !== undefined && !block.time) {
      loose ??= inboxBlock(path, start - 1);
      loose.tasks.push(parseTask(body, status, source));
      current = loose;
      continue;
    }
    if (status !== undefined) {
      block.tasks.push({ source, text: block.title, status: toStatus(status) });
    }
    current = block;
    blocks.push(block);
  }

  if (loose) {
    const inbox = blocks.find((b) => !b.time && b.title === "Unscheduled");
    if (!inbox) return [...blocks, loose];
    const at = inbox.tasks.length;
    for (const n of loose.notes ?? []) (inbox.notes ??= []).push({ text: n.text, at: at + n.at });
    inbox.tasks.push(...loose.tasks);
  }

  return blocks;
}

function inboxBlock(path: string, line: number): Block {
  return { source: { path, line }, title: "Unscheduled", tasks: [], scheduled: false };
}

export {
  parseSchedule,
  parseStartClock,
  parseEndClock,
  parseTimeRangeText,
  formatClock,
  formatTimeRange,
};
export type { TimeRangeText };

// exported for unit testing of the pieces
export {
  parseAssociation,
  parseBlock,
  parseTask,
  parseTime,
  stripMetadata,
};

// ─── block / task construction ─────────────────────────────────

function parseBlock(body: string, source: SourceRef): Block {
  const { title, assoc, metadata } = stripMetadata(body);
  const time = parseTime(title);
  // when a time range is present, the block title is the text after it
  const blockTitle = time ? time.title : title;

  const base: Omit<Block, "scheduled"> = {
    source,
    title: blockTitle,
    ...(assoc ? { assoc } : {}),
    ...(metadata ? { metadata } : {}),
    tasks: [],
  };

  if (time) {
    const block: Block = { ...base, scheduled: true, time: time.range };
    return block;
  }

  // Non-timed top-level item: the reserved Unscheduled inbox block.
  // Any other untimed item is treated as unscheduled as well.
  if (UNSCHEDULED_TITLE.test(base.title)) base.title = "Unscheduled";
  const block: Block = { ...base, scheduled: false };
  return block;
}

function parseTask(
  body: string,
  status: string | undefined,
  source: SourceRef,
): Task {
  const { title, assoc, metadata } = stripMetadata(body);
  return {
    source,
    text: title,
    status: toStatus(status),
    ...(assoc ? { assoc } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

// An unknown status char reads as open.
function toStatus(status: string | undefined): TaskStatus {
  switch (status) {
    case "x":
    case "/":
    case "-":
      return status;
    default:
      return " ";
  }
}

// ─── metadata stripping ────────────────────────────────────────

interface Metadata {
  title: string;
  assoc?: Association;
  metadata?: string;
}

/**
 * Strip trailing associations and a trailing parenthesised note off a title.
 * Associations are matched right-to-left; the last one wins for `assoc`
 * (there is at most one Association per line in the model). The parenthesised
 * note becomes `metadata` and is stripped before associations if it trails
 * them, and after if it doesn't — both orderings in the sample resolve
 * correctly.
 */
function stripMetadata(body: string): Metadata {
  let title = body.trim();
  let assoc: Association | undefined;
  let metadata: string | undefined;

  // Loop peeling trailing [assoc] and (note) tokens in whatever order.
  for (;;) {
    const a = TRAILING_ASSOC.exec(title);
    if (a) {
      const parsed = parseAssociation(a[1] ?? "");
      // keep the first (rightmost-parsed) association we encounter
      if (parsed && !assoc) assoc = parsed;
      title = title.slice(0, a.index).trimEnd();
      continue;
    }
    const p = TRAILING_PAREN.exec(title);
    if (p && metadata === undefined && !isLinkParen(title, p)) {
      metadata = (p[1] ?? "").trim();
      title = title.slice(0, p.index).trimEnd();
      continue;
    }
    break;
  }

  return {
    title,
    ...(assoc ? { assoc } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

// A trailing "(...)" that's part of a link, not a note: the destination of a
// markdown link ("[docs](https://…)", "[plan](My%20Plan.md)") or the end of a
// bare URL ("…/wiki/Foo_(bar)"). Only a paren glued to what's before it can be
// one; "Write [Kairos](draft)" still reads as an association and a note.
function isLinkParen(title: string, match: RegExpExecArray): boolean {
  const open = title.indexOf("(", match.index);
  const before = title[open - 1];
  if (before === undefined || /\s/.test(before)) return false;
  const inner = match[1] ?? "";
  if (before === "]") return /:\/\/|%20|\.md(#|$)|^(mailto|obsidian):/i.test(inner);
  const word = title.slice(0, open).split(/\s/).pop() ?? "";
  return /^\S*https?:\/\//i.test(word);
}

/** Classify a bracket tag: `D:Name` → domain, anything else → project. */
function parseAssociation(inner: string): Association | undefined {
  const id = inner.trim();
  if (!id) return undefined;
  const domain = /^D:\s*(.+)$/i.exec(id);
  if (domain) return { kind: "domain", id: (domain[1] ?? "").trim() };
  return { kind: "project", id };
}

// ─── time ──────────────────────────────────────────────────────

interface ParsedTime {
  range: TimeRange;
  title: string; // text following the time range
}

/** Parse a leading `HH:MM - HH:MM` time range; undefined if none. */
function parseTime(text: string): ParsedTime | undefined {
  const m = TIME_RANGE.exec(text.trim());
  if (!m) return undefined;

  const start = toMinutes(m[1], m[2]);
  if (start === undefined) return undefined;
  const end = toEndMinutes(m[3], m[4], start);
  if (end === undefined || end <= start) return undefined;

  return { range: { start, end }, title: (m[5] ?? "").trim() };
}

/** A bare "HH:MM" start time → minutes since midnight; undefined if invalid. */
function parseStartClock(value: string): number | undefined {
  const m = CLOCK.exec(value.trim());
  return m ? toMinutes(m[1], m[2]) : undefined;
}

/**
 * A bare "HH:MM" end time for a range starting at `start` → minutes since
 * midnight; undefined if invalid. Midnight reads as either "24:00" or "00:00".
 * Unlike a note's range, "00:00" is midnight even from a midnight start: a
 * midnight end is often typed "00:00", and an empty 00:00–00:00 range is never
 * what was meant.
 */
function parseEndClock(value: string, start: number): number | undefined {
  const m = CLOCK.exec(value.trim());
  if (!m) return undefined;
  const end = toEndMinutes(m[1], m[2], start);
  return end === 0 ? MIDNIGHT : end;
}

type TimeRangeText =
  | { ok: true; range: TimeRange }
  | { ok: false; error: string };

/**
 * A time range typed into an editor ("9:00 - 10:30", "09:00–10:30") → the
 * range, or a short error to show the user. Built on parseStartClock and
 * parseEndClock, so it takes exactly the times a note's range does, plus a
 * midnight end written "00:00" (see parseEndClock).
 */
function parseTimeRangeText(text: string): TimeRangeText {
  const m = RANGE_TEXT.exec(text.trim());
  if (!m) return { ok: false, error: "Write the time like 09:00 - 10:30." };
  const [, h1 = "", m1 = "", h2 = "", m2 = ""] = m;
  if (Number(m1) > 59 || Number(m2) > 59) {
    return { ok: false, error: "Minutes go up to 59." };
  }
  const start = parseStartClock(`${h1}:${m1}`);
  if (start === undefined) return { ok: false, error: "The start must be before 24:00." };
  const end = parseEndClock(`${h2}:${m2}`, start);
  if (end === undefined) return { ok: false, error: "The end can't be after 24:00." };
  if (end <= start) return { ok: false, error: "The end must be after the start." };
  return { ok: true, range: { start, end } };
}

/** Minutes since midnight → "HH:MM"; the end of the day (1440) is "24:00". */
function formatClock(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** A range as "HH:MM–HH:MM" (or with `dash`), which parseTimeRangeText reads back. */
function formatTimeRange(range: TimeRange, dash = "–"): string {
  return `${formatClock(range.start)}${dash}${formatClock(range.end)}`;
}

function toMinutes(h: string | undefined, min: string | undefined): number | undefined {
  const hh = Number(h);
  const mm = Number(min);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return undefined;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
  return hh * 60 + mm;
}

// An end time may also be midnight: "24:00", or "00:00" after a later start
// ("23:00 - 00:00"). Both read as minute 1440 so the range stays ordered.
function toEndMinutes(
  h: string | undefined,
  min: string | undefined,
  start: number,
): number | undefined {
  if (Number(h) === 24 && Number(min) === 0) return MIDNIGHT;
  const end = toMinutes(h, min);
  return end === 0 && start > 0 ? MIDNIGHT : end;
}

// ─── helpers ───────────────────────────────────────────────────

function findScheduleStart(lines: string[], heading: string): number {
  const matcher = headingMatcher(heading);
  for (let i = 0; i < lines.length; i++) {
    if (matcher.test(lines[i] ?? "")) return i + 1;
  }
  return -1;
}

// Treat a tab as one indent step; count leading spaces as-is. Nesting only
// needs relative comparison, so exact widths don't matter as long as a deeper
// item compares greater than its parent.
function indentWidth(ws: string): number {
  let width = 0;
  for (const ch of ws) width += ch === "\t" ? 4 : 1;
  return width;
}
