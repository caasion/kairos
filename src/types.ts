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
  date: ISODate;
  status: LifecycleState;
  // Freeform open-label annotation (e.g. "baseline"/"hard"/"taper"), carrying
  // intensity or intent. Never logic — same principle as a task's metadata tag.
  // Meaningful only on `active` records by convention; parsed/serialized verbatim.
  note?: string;
}

interface Project {
  id: string;
  name: string;
  aliases: string[];
  description: string; // free-text blurb, shown inline on the projects page
  domain?: string; // at most one, by name
  history: StatusRecord[];
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
  Project,
  Domain,
  BacklogEntry,
  ResolvedTask,
  Index,
};

export { isCheckable, minutesOf };