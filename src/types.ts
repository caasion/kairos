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
  tag?: string; // freeform user metadata (priority stand-in)
}

// ─── block ─────────────────────────────────────────────────────

interface BlockBase {
  source: SourceRef;
  title: string;
  assoc?: Association;
  tasks: Task[];
  task?: Task; // present iff line carries a checkbox; shares block's line
}

interface TimedBlock extends BlockBase {
  kind: "timed";
  time: TimeRange;
}

interface UnscheduledBlock extends BlockBase {
  kind: "unscheduled"; // one reserved inbox block per daily note
}

type Block = TimedBlock | UnscheduledBlock;

type CheckableBlock = Block & { task: Task };

const isCheckable = (b: Block): b is CheckableBlock => b.task !== undefined;

const minutesOf = (b: Block): Minutes =>
  b.kind === "timed" ? b.time.end - b.time.start : 0;

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
}

interface Project {
  id: string;
  name: string;
  aliases: string[];
  domain?: string; // at most one, by name
  history: StatusRecord[];
  archived: boolean;
  source: SourceRef; // project file / folder note
}

interface Domain {
  id: string;
  name: string;
  aliases: string[];
  order: number;
  color: string;
  effective: { start?: ISODate; end?: ISODate };
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

// ─── resolved (derived) ────────────────────────────────────────

interface ResolvedTask extends Task {
  date: ISODate;
  blockId?: string; // undefined → Unscheduled
  owner?: Association; // assoc ?? block.assoc ?? none
  scheduled: boolean; // true iff inside a block that isn't Unscheduled
  colocated: boolean; // shares its line with a block
}

// ─── index ─────────────────────────────────────────────────────

interface Index {
  days: Map<ISODate, Day>;
  projects: Map<string, Project>;
  domains: Map<string, Domain>;
  backlog: BacklogEntry[];

  byProject: Map<string, ResolvedTask[]>;
  byDomain: Map<string, ResolvedTask[]>;
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
  TimedBlock,
  UnscheduledBlock,
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