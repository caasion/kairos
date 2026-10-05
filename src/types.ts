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

// A `status:` entry Kairos would not itself have written, kept rather than
// thrown away. Two shapes turn up in files people hand-wrote: the flat scalar
// (`2026-08-04: active`), which parses fine but isn't the object form we emit,
// and a state outside the lifecycle vocabulary (`draft`), which can't become a
// record at all. Both used to disappear — the unknown state from the parsed
// history, the flat scalar from the file the first time anything wrote it — and
// the user was told neither. An anomaly carries the entry verbatim so a write
// re-emits exactly what was there, plus enough description to say, on the
// Projects page, what was found and what normalising would change it to.
type StatusAnomalyKind =
  | "bare-string" // `2026-08-04: active` — valid, but not the object form
  | "unknown-state" // a status outside active/inactive/archived
  | "bad-date"; // a key that isn't YYYY-MM-DD

interface StatusAnomaly {
  kind: StatusAnomalyKind;
  key: string; // the frontmatter key exactly as written
  raw: unknown; // the value exactly as written — re-emitted verbatim on write
  found: string; // how the entry reads in the file, for the warning line
  becomes: string | null; // what normalising makes of it; null when we can't say
  // The record normalising would add to the history. Only a `bad-date` whose key
  // is a paddable near-miss carries one — a `bare-string` already produced its
  // record, and an unknown state can't produce one at all.
  record?: StatusRecord;
}

interface Project {
  id: string;
  name: string;
  aliases: string[];
  description: string; // free-text blurb, shown inline on the projects page
  domain?: string; // at most one, by name
  history: StatusRecord[];
  // Non-canonical `status:` entries found on parse. Absent when the file is
  // clean, so a parsed entity only carries the key when there is something to
  // say about it.
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