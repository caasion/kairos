// Kairos core types

// ─── primitives ────────────────────────────────────────────────

type Minutes = number; // minutes since midnight
type ISODate = string; // YYYY-MM-DD

interface TimeRange {
  start: Minutes;
  end: Minutes; // must be > start
}

interface SourceRef {
  path: string;
  line: number;
}

// ─── association ───────────────────────────────────────────────

type Association =
  | { kind: "project"; id: string } // [Project]
  | { kind: "domain"; id: string }; // [D:Domain]

// ─── task ──────────────────────────────────────────────────────

type TaskStatus = " " | "x" | "/" | "-"; // [ ] [x] [/] [-]

interface Task {
  source: SourceRef;
  text: string;
  status: TaskStatus;
  assoc?: Association; // absent → inherits parent block's assoc
  metadata?: string; // freeform user data (priority stand-in, and anything else)
}

// ─── resolved (derived) ────────────────────────────────────────

interface ResolvedTask extends Task {
  date: ISODate;
  block: Block; // a reference to the parent block
  owner?: Association; // assoc ?? block.assoc ?? none
  scheduled: boolean; // true iff inside a block that isn't Unscheduled
  colocated: boolean; // shares its line with a block
}

// ─── block ─────────────────────────────────────────────────────

// A block is a task with scheduling: it carries the same intrinsic fields a
// task does (title/text, status, association, metadata) plus a time range and
// child tasks. The only things distinguishing a block from a task are time and
// scheduling — a block is checkable in its own right when `status` is present.
interface Block {
  source: SourceRef;
  title: string;
  assoc?: Association;
  metadata?: string; // freeform user data, same as a task's
  tasks: Task[];
  status?: TaskStatus; // present iff the block line carries a checkbox
  scheduled: boolean;
  time?: TimeRange;
}

type CheckableBlock = Block & { status: TaskStatus };

const isCheckable = (b: Block): b is CheckableBlock => b.status !== undefined;

const minutesOf = (b: Block): Minutes =>
  b.time ? b.time.end - b.time.start : -1;

// ─── daily note ────────────────────────────────────────────────

interface Day {
  date: ISODate;
  path: string;
  mtime: number;
  blocks: Block[];
}

// ─── project / domain ──────────────────────────────────────────

type LifecycleState = "active" | "inactive" | "archived";

interface StatusRecord {
  date: ISODate; // the day the change was recorded, not an effective-from date
  status: LifecycleState;
  // What this state entails: freeform prose describing what the phase actually
  // consists of ("getting groceries, meal planning, doing laundry"). An open
  // label, never logic and never a keyword vocabulary — parsed and serialized
  // verbatim, and meaningful on any status, not just `active`.
  note?: string;
  // What moved the entity into this state ("stepped down after the handoff").
  // Distinct from `note`, which says what the state entails, and from a
  // project's `description`, which says what the project entails generally.
  why?: string;
}

// A `status:` entry Kairos would not itself have written, noted on parse. Two
// kinds are fixable and already became records — the flat scalar
// (`2026-08-04: active`) and a near-miss key that pads to a free date
// (`2026-8-4`) — so the next write emits them canonically. The other two can't
// become records at all: a state outside the lifecycle vocabulary (`draft`) and
// a key that isn't a usable date. Those are kept verbatim (`raw`) and re-emitted
// on every write, so no edit deletes what the user typed, but they never drive
// derived state.
type StatusAnomalyKind =
  | "bare-string" // fixable: `2026-08-04: active`, not the object form
  | "padded-date" // fixable: `2026-8-4`, pads to a free YYYY-MM-DD
  | "unknown-state" // kept: a status outside active/inactive/archived
  | "bad-date"; // kept: a key that isn't (or can't safely become) YYYY-MM-DD

interface StatusAnomaly {
  kind: StatusAnomalyKind;
  key: string; // the frontmatter key exactly as written
  raw: unknown; // the value exactly as written — re-emitted verbatim when kept
}

interface Project {
  id: string;
  name: string;
  aliases: string[];
  description: string; // free-text blurb, shown inline on the projects page
  domain?: string; // at most one, by name
  // `rollup: true` in frontmatter: the project is "not worth its own row" — in
  // the Grid its tasks render on its domain's row, grouped under a header (#11).
  // Absent means false; only meaningful when `domain` is set. Kept optional so a
  // project that never had the flag never grows a `rollup: false` key.
  rollup?: boolean;
  history: StatusRecord[];
  // Non-canonical `status:` entries found on parse. Absent when the file is
  // clean, so a parsed entity only carries the key when there is something to
  // fix or preserve.
  anomalies?: StatusAnomaly[];
  archived: boolean;
  source: SourceRef; // project file / folder note
}

interface Domain {
  id: string;
  name: string;
  aliases: string[];
  description: string; // free-text blurb, shown inline on the projects page
  order: number;
  color: string;
  history: StatusRecord[];
  anomalies?: StatusAnomaly[]; // see `Project.anomalies`
  archived: boolean;
  source: SourceRef;
}

// ─── backlog ───────────────────────────────────────────────────

// Single global flat file. Entries are not tasks; cannot be checked.
interface BacklogEntry {
  source: SourceRef;
  text: string;
  assoc?: Association; // project, domain, or none
  resurface?: ISODate; // snooze / visibility date
}

// ─── index ─────────────────────────────────────────────────────

interface Index {
  days: Map<ISODate, Day>;
  projects: Map<string, Project>;
  domains: Map<string, Domain>;
  backlog: BacklogEntry[];

  byProject: Map<string, ResolvedTask[]>;
  byDomain: Map<string, ResolvedTask[]>;
  // Child projects of each domain, keyed by the domain's stable id (a project
  // links to its domain by id, not name). Feeds the Grid view's expand-domains
  // toggle. Excludes archived projects.
  byDomainProjects: Map<string, Project[]>;
}

export type {
  Minutes,
  ISODate,
  TimeRange,
  SourceRef,
  Association,
  TaskStatus,
  Task,
  Block,
  CheckableBlock,
  Day,
  LifecycleState,
  StatusRecord,
  StatusAnomalyKind,
  StatusAnomaly,
  Project,
  Domain,
  BacklogEntry,
  ResolvedTask,
  Index,
};

export { isCheckable, minutesOf };