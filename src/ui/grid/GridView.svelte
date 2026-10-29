<script lang="ts">
	// The Grid view — triage between tasks and their projects/domains (spec §5).
	//
	// Layout: rows = associations (projects, then domains, then unassigned),
	// columns = the visible days, cells = the tasks associated with that row on
	// that day. Domains are always fully expanded — every child project row is
	// always visible, no collapse state. A project flagged `rollup: true` (#11)
	// has no row: its tasks render on its domain's row under a project header.
	//
	// Data comes from the index's reactive `grid(dates)` feed; the row model
	// (buildRows / cellTasks) is pure and lives in gridModel.ts. This component
	// owns the day window, the association picker, and the edit → index write
	// routing. Every task write rebuilds the affected day's blocks with a pure
	// writer transform and commits via `applyDayEdit`, exactly like the timeline.

	import type { App } from "obsidian";
	import { Menu } from "obsidian";
	import { onMount } from "svelte";
	import type { Readable, Unsubscriber } from "svelte/store";
	import type { KairosSettings } from "../../settings";
	import type {
		Association,
		BacklogEntry,
		Block,
		ISODate,
		ResolvedTask,
		Task,
		TaskStatus,
	} from "../../types";
	import {
		addTaskToBlock,
		addTaskToUnscheduled,
		copyBlockIntoDay,
		copyTaskIntoDay,
		deleteBlock,
		deleteTask,
		moveBlockAcrossDays,
		moveTaskAcrossDays,
		nestTaskUnderBlock,
		setBlockAssoc,
		setBlockTitle,
		setTaskStatus,
		setTaskText,
		unnestTask,
	} from "../../writer";
	import { blockOptions, type BlockOption } from "../../blockOptions";
	import type { GridDay, GridSnapshot, KairosIndex, Resolver } from "../../index";
	import { startDragScroll, type DragScroll } from "../dragScroll";
	import { hitTestGridCell, hitTestGridGroup, hitTestTimeline, type BlockDragState, type GridDropSlot, type GridGroupDrop, type TaskDragState } from "../timeline/taskDrag";
	import { newBlockLabel, type TimelineDrop } from "../../taskDrop";
	import { dropTaskOnTimeline } from "../timeline/dropTask";
	import {
		blockLit,
		hoverBlockTarget,
		hoverTaskTarget,
		taskHighlight,
		type Highlight,
		type HoverTarget,
		type ViewLinks,
	} from "../../viewLinks";
	import { navigateToAssociation } from "../../navigate";
	import {
		blockGroups,
		isUnscheduledBlock,
		buildRows,
		dayStatus,
		intensityChange,
		intensityOn,
		intentionChange,
		blockDropAssociation,
		dropAssociation,
		ownerRowKey,
		sourceKey,
		rolledUpProjectOf,
		rolledUpProjects,
		rowAssociation,
		type BlockGroup,
		type GridRow,
	} from "../../gridModel";
	import { addChangeDomainItem, addRollupItem, submenuOf } from "../projects/projectMenu";
	import type { LeftoverActions, RoutineActions } from "../../routines/routinesFeed";
	import type { Leftover } from "../../carry";
	import LeftoverTask from "../timeline/LeftoverTask.svelte";
	import HeaderBadge from "../timeline/HeaderBadge.svelte";
	import AssocGroup from "../timeline/AssocGroup.svelte";
	import { groupByAssoc } from "../timeline/groupByAssoc";
	import TaskRow from "../task/Task.svelte";
	import { leftOpenLabel, todayLeftovers } from "../timeline/todayLeftovers";
	import LeftoverButtons from "../timeline/LeftoverButtons.svelte";
	import { routinesToOffer, type RoutineList } from "../../routines/preview";
	import { dayLabel } from "../../routines/plan";
	import RoutinesAlert from "../routines/RoutinesAlert.svelte";
	import { surfacedOn } from "../../backlogModel";
	import {
		insertEntry,
		moveTaskToBacklog,
		resurfaceTomorrow,
		setResurface,
	} from "../../backlogActions";
	import {
		dateFromISO,
		ensureNoteForDate,
		isoFromDate,
		shiftISO,
		todayISO,
	} from "../../dayNote";
	import { nextDraftLine } from "../../draftLine";
	import GridCell from "./GridCell.svelte";
	import RowLabel from "../components/RowLabel.svelte";
	import IntensityBars from "../components/IntensityBars.svelte";
	import type { RowLabelInfo } from "../components/rowLabel";
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import { createAssociation } from "../association/createAssociation";
	import BlockPicker from "../timeline/BlockPicker.svelte";
	import Datepicker from "../components/Datepicker.svelte";
	import BacklogNudge from "../backlog/BacklogNudge.svelte";
	import { placeUnderAnchor } from "../floating";
	import { intoViewHeader } from "../actions/viewHeader";

	interface Props {
		app: App;
		index: KairosIndex;
		settings$: Readable<KairosSettings>;
		updateSettings: (mutate: (s: KairosSettings) => void) => void;
		// Open the Day view and scroll to a block (a nested task's badge click).
		reveal: (date: ISODate, blockLine: number) => void;
		// The Grid ↔ timeline bridge: focus for the Day view to follow, the live
		// drag every timeline previews, hover, and the Day view's date.
		links: ViewLinks;
		// Open the Day view on a date (a column header click).
		showDay: (date: ISODate) => void;
		// Each day's missing routines, behind a pill on its date header.
		routineActions: RoutineActions;
		// Yesterday's open tasks, for today's Inbox badge.
		leftoverActions: LeftoverActions;
		// The leaf's tab header, which the header bar moves into.
		viewHeader?: HTMLElement;
	}

	let {
		app,
		index,
		settings$,
		updateSettings,
		reveal,
		links,
		showDay,
		routineActions,
		leftoverActions,
		viewHeader,
	}: Props = $props();

	// ── Bridge to the timelines (viewLinks.ts) ──
	// Acting on a day here (grab, add or edit a task) asks the Day view to show
	// it; the Day view follows when "Follow the grid" is on. Selecting a column
	// header is a direct ask (`showDay`), which opens the Day view on that day.
	function focusDay(date: ISODate) {
		links.focus(date);
	}

	// The date the Day view is showing, marked on its column header. And the item
	// under the pointer in any view, so the same task glows here. Both mirrored
	// from the stores on mount, like the resolver.
	let dayViewDate = $state<ISODate | null>(null);
	let hovered = $state<HoverTarget | null>(null);

	// A Grid task's hover identity.
	function hoverTargetOf(task: ResolvedTask): HoverTarget {
		return hoverTaskTarget(task, task.block);
	}
	function onTaskHover(task: ResolvedTask, on: boolean) {
		const target = hoverTargetOf(task);
		if (on) links.setHover(target);
		else links.clearHover(target);
	}
	// One rule for every view (viewLinks.ts): pointing at a block, its header or
	// any task in it lights the block's header and all its tasks; the task
	// pointed at is marked on top.
	function highlightOf(task: ResolvedTask): Highlight {
		return taskHighlight(hovered, task, task.block);
	}
	function isBlockLinked(block: Block): boolean {
		return blockLit(hovered, block);
	}
	function onBlockHover(block: Block, on: boolean) {
		const target = hoverBlockTarget(block);
		if (on) links.setHover(target);
		else links.clearHover(target);
	}

	const settings = $derived($settings$);

	// ── The day window (mirrors the Week view's windowing) ──
	function clampSpan(n: number): number {
		return Math.max(1, Math.min(7, Math.floor(n)));
	}
	const before = $derived(clampSpan(settings.weekDaysBefore));
	const after = $derived(clampSpan(settings.weekDaysAfter));
	const windowSize = $derived(before + after + 1);

	let anchor = $state<ISODate>(shiftISO(todayISO(), -clampSpan(1)));
	let atDefault = $state(true);
	$effect(() => {
		if (atDefault) anchor = shiftISO(todayISO(), -before);
	});

	const dates = $derived(
		Array.from({ length: windowSize }, (_, i) => shiftISO(anchor, i)),
	);

	function stepWindow(deltaDays: number) {
		atDefault = false;
		anchor = shiftISO(anchor, deltaDays);
		closeAssocPicker();
	}
	function goToday() {
		atDefault = true;
		anchor = shiftISO(todayISO(), -before);
		closeAssocPicker();
	}
	function jumpTo(date: ISODate) {
		atDefault = false;
		anchor = shiftISO(date, -before);
		showCalendar = false;
		closeAssocPicker();
	}

	const rangeLabel = $derived.by(() => {
		const fmt = (d: ISODate) =>
			dateFromISO(d).toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
			});
		return `${fmt(dates[0]!)} – ${fmt(dates[dates.length - 1]!)}`;
	});
	// A date card's two lines: an uppercase day-of-week label over the day number
	// (Holos-style header). Kept as separate accessors so the markup can stack them.
	function dowLabel(date: ISODate): string {
		return dateFromISO(date)
			.toLocaleDateString(undefined, { weekday: "short" })
			.toUpperCase();
	}
	function dayNumber(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, { day: "numeric" });
	}
	function isToday(date: ISODate): boolean {
		return date === todayISO();
	}

	// ── The grid feed ──
	// Re-subscribe whenever the visible dates change (window nav / span change).
	let snapshot = $state<GridSnapshot | undefined>(undefined);
	let unsubscribeGrid: Unsubscriber | null = null;
	let lastDatesKey = "";
	$effect(() => {
		const key = dates.join(",");
		if (key === lastDatesKey) return;
		lastDatesKey = key;
		unsubscribeGrid?.();
		unsubscribeGrid = index.grid(dates).subscribe((s) => {
			snapshot = s;
		});
	});

	let resolve = $state<Resolver>(() => ({ displayName: "", resolved: false }));

	// ── Routines ──
	// A day's missing routines sit behind a pill on its date header, opened on
	// hover (RoutinesAlert). preview.ts decides what each day offers; routines
	// whose project or domain isn't active that day are paused (owners.ts).
	// The stores are fixed for the view's lifetime, so reading them once is right.
	// svelte-ignore state_referenced_locally
	const { routines$, marks$, active$ } = routineActions;
	const routines = $derived($routines$);
	const marks = $derived($marks$);
	const active = $derived($active$);

	const rows = $derived<GridRow[]>(snapshot ? buildRows(snapshot, todayISO()) : []);

	// date → what that day's routines alert offers.
	const routinesByDate = $derived.by(() => {
		const today = todayISO();
		const out = new Map<ISODate, RoutineList>();
		for (const date of dates) {
			const recorded = marks(date);
			out.set(
				date,
				routinesToOffer({
					date,
					today,
					...(recorded !== undefined ? { recorded } : {}),
					routines: routines.routines,
					blocks: dayOf(date)?.blocks ?? [],
					active,
				}),
			);
		}
		return out;
	});

	// Whether a row is the last of its domain group — a domain header and its child
	// project rows share one accent color and read as one block, so the divider
	// between them is dropped and only reappears after the group's last child. We
	// mark each row's group-end position from the flat row list.
	function isGroupEnd(i: number): boolean {
		const row = rows[i]!;
		if (row.kind === "unassigned") return true;
		const next = rows[i + 1];
		const nextIsChild = next?.kind === "project" && next.depth > 0;
		return !nextIsChild;
	}

	// A cell's blocks and tasks, grouped by block: every timed block in its own
	// row, and each block's tasks in theirs.
	function cellFor(row: GridRow, day: GridDay): { blocks: BlockGroup[] } {
		if (!snapshot) return { blocks: [] };
		// With Unscheduled behind each day's header badge instead (the setting
		// off), a cell drops its Unscheduled group, except during a drag, where
		// that group is still where a task lands to come out of its block.
		const groups = blockGroups(row, day.tasks, snapshot, day.blocks);
		if (settings.gridUnscheduledInCells || taskDrag) return { blocks: groups };
		return { blocks: groups.filter((g) => !isUnscheduledBlock(g.block)) };
	}

	// The project chip on a rolled-up task's line (domain rows, when on).
	function chipFor(row: GridRow): ((task: ResolvedTask) => string | undefined) | undefined {
		if (!settings.gridShowRollupProjects || !snapshot) return undefined;
		const snap = snapshot;
		return (task) => rolledUpProjectOf(row, task, snap);
	}

	// The block group a live task drag would land in, for this cell (date, row):
	// the group under the pointer, or — when the pointer is over a timeline — that
	// block (or Unscheduled) in every row it shows in.
	function dropGroupOn(date: ISODate, row: GridRow): number | "unscheduled" | undefined {
		const g = groupDrop;
		if (g) {
			if (g.rowKey !== row.key || g.drop.date !== date) return undefined;
			if (g.drop.kind === "unscheduled") return "unscheduled";
			return g.drop.kind === "block" ? g.drop.blockLine : undefined;
		}
		const t = timelineDrop;
		if (!t || t.date !== date) return undefined;
		if (t.kind === "unscheduled") return "unscheduled";
		return t.kind === "block" ? t.blockLine : undefined;
	}

	// While a task is dragged over a grouped cell with no Unscheduled group, the
	// cell offers an empty one to drop into, so a task can always leave its block.
	// Only the cell under the pointer grows, so the rest of the grid holds still.
	function wantsUnscheduledSlot(
		cell: { blocks: BlockGroup[] },
		inactive: boolean,
		date: ISODate,
		row: GridRow,
	): boolean {
		if (taskDrag === null || inactive) return false;
		if (cell.blocks.some((g) => isUnscheduledBlock(g.block))) return false;
		const overCell =
			(taskDrop?.date === date && taskDrop.rowKey === row.key) ||
			(groupDrop?.drop.date === date && groupDrop.rowKey === row.key);
		return overCell;
	}

	function setHighlightAcrossViews(on: boolean) {
		updateSettings((s) => {
			s.highlightAcrossViews = on;
		});
	}
	function setUnscheduledInCells(on: boolean) {
		updateSettings((s) => {
			s.gridUnscheduledInCells = on;
		});
	}
	function setShowRollupProjects(on: boolean) {
		updateSettings((s) => {
			s.gridShowRollupProjects = on;
		});
	}

	// The row's entity was inactive/archived on this day — the cell is read-only
	// history (dimmed, no create, no drop). Drives both the cell's presentation
	// and the drag guard below.
	function isCellInactive(row: GridRow, date: ISODate): boolean {
		return snapshot ? dayStatus(row, date, snapshot) !== "active" : false;
	}

	// ── Intensity and intention ──
	// A row's label shows its intensity on the first visible day; a cell where a
	// record moves the level later in the window carries a small marker, so the
	// window reads left to right like the Gantt does. The label's intention stays
	// today's (prose is too long to be a starting point the way the intensity bars are),
	// so a new intention anywhere in the window, the first day included, gets a
	// notebook icon in its cell whose tooltip reads it out.
	function labelInfo(row: Exclude<GridRow, { kind: "unassigned" }>): RowLabelInfo {
		const on = dates[0];
		if (!snapshot || !on) return row.info;
		const level = intensityOn(row, on, snapshot);
		return level === null ? row.info : { ...row.info, intensity: { level, on } };
	}
	function changeOn(row: GridRow, date: ISODate, inactive: boolean) {
		if (!snapshot || inactive || date === dates[0]) return null;
		return intensityChange(row, date, snapshot);
	}
	function intentionOn(row: GridRow, date: ISODate, inactive: boolean): string | null {
		if (!snapshot || inactive) return null;
		return intentionChange(row, date, snapshot);
	}

	// ── Resurfaced backlog nudges ──
	// Entries with a resurface date surface on one day (max(resurface, today)),
	// behind that day's Inbox badge (they used to sit in its cells).
	let backlogEntries = $state<BacklogEntry[]>([]);

	// Each day's header badges — its Unscheduled tasks across every
	// row, and its Inbox (resurfacing entries, plus yesterday's open tasks on
	// today), both grouped by association like the rows they came out of.
	function unscheduledOn(date: ISODate): ResolvedTask[] {
		return dayOf(date)?.tasks.filter((t) => isUnscheduledBlock(t.block)) ?? [];
	}
	function surfacedOnDate(date: ISODate): BacklogEntry[] {
		return surfacedOn(backlogEntries, date, todayISO());
	}
	function leftoversOn(date: ISODate): Leftover[] {
		return $left$ && $left$.today === date ? $left$.items : [];
	}
	// The cell "+" adds to Unscheduled, which no longer shows in the cell: it
	// opens that day's badge so the new task is in view.
	let unscheduledOpen = $state<Record<string, boolean>>({});

	// Yesterday's open tasks, for today's Inbox badge.
	// svelte-ignore state_referenced_locally
	const left$ = todayLeftovers(index, leftoverActions);
	const leftFrom = $derived($left$ ? dayLabel($left$.from.date) : "");
	function settleLeftover(l: Leftover, status: "x" | "-") {
		const day = $left$?.from;
		if (!day) return;
		index.applyDayEdit(day.date, day.path, setTaskStatus(day.blocks, l.owner, l.task, status));
	}
	function bringLeftover(l: Leftover) {
		if ($left$) leftoverActions.bring($left$.today, $left$.from.date, [l.task.source]);
	}

	function onNudgeInsert(entry: BacklogEntry, date: ISODate) {
		void insertEntry(index, entry, date);
	}
	function onNudgeResurfaceTomorrow(entry: BacklogEntry) {
		resurfaceTomorrow(index, backlogEntries, entry);
	}

	// Resurface-at datepicker (parent-owned so it isn't clipped by a cell).
	let resurfaceEntry = $state<BacklogEntry | null>(null);
	let resurfaceAnchor = $state<DOMRect | null>(null);
	let resurfaceValue = $state<Date>(dateFromISO(todayISO()));
	// Placed off-screen until measured so it never flashes at the anchor before
	// being clamped into the viewport.
	let resurfacePopupEl = $state<HTMLElement>();
	let resurfaceStyle = $state("left: -9999px; top: -9999px;");
	function onNudgeResurfaceAt(entry: BacklogEntry, anchor: DOMRect) {
		resurfaceStyle = "left: -9999px; top: -9999px;"; // hide until measured
		resurfaceEntry = entry;
		resurfaceAnchor = anchor;
		resurfaceValue = dateFromISO(entry.resurface ?? todayISO());
	}
	function closeResurfaceAt() {
		resurfaceEntry = null;
		resurfaceAnchor = null;
	}
	// Once the popup renders, measure its real size and clamp it inside the
	// viewport (flipping above the anchor when a below placement would overflow).
	$effect(() => {
		const el = resurfacePopupEl;
		const anchor = resurfaceAnchor;
		if (!el || !anchor) return;
		resurfaceStyle = placeUnderAnchor(anchor, {
			width: el.offsetWidth,
			height: el.offsetHeight,
		});
	});
	function onResurfaceAtSelect(picked: Date) {
		const entry = resurfaceEntry;
		closeResurfaceAt();
		if (entry) setResurface(index, backlogEntries, entry, isoFromDate(picked));
	}

	// ── Edit routing (task writes → index) ──
	// Every write rebuilds the task's day from the snapshot's blocks with a pure
	// writer transform, then commits via applyDayEdit. Path is guaranteed by the
	// day having tasks (it has a note); create ensures a note first.

	function dayOf(date: ISODate): GridDay | undefined {
		return snapshot?.days.find((d) => d.date === date);
	}

	function commit(date: ISODate, path: string, blocks: Block[]) {
		index.applyDayEdit(date, path, blocks);
	}

	function onSetStatus(task: ResolvedTask, status: TaskStatus) {
		focusDay(task.date);
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		commit(
			task.date,
			day.path,
			setTaskStatus(day.blocks, task.block, task, status),
		);
	}
	function onSetText(task: ResolvedTask, text: string) {
		focusDay(task.date);
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		commit(task.date, day.path, setTaskText(day.blocks, task.block, task, text));
	}
	function onDelete(task: ResolvedTask) {
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		commit(task.date, day.path, deleteTask(day.blocks, task.block, task));
	}

	// ── Block edits (a block group's header) ──
	// The same actions as a timeline block's menu and action bar (blockMenu.ts),
	// each a pure writer transform on the block's day, committed like a task's.

	function editBlock(date: ISODate, edit: (blocks: Block[]) => Block[]) {
		focusDay(date);
		const day = dayOf(date);
		if (!day || day.path === null) return;
		commit(date, day.path, edit(day.blocks));
	}
	function onDeleteBlock(date: ISODate, block: Block) {
		editBlock(date, (blocks) => deleteBlock(blocks, block));
	}
	function onSetBlockTitle(date: ISODate, block: Block, title: string) {
		editBlock(date, (blocks) => setBlockTitle(blocks, block, title));
	}

	// Send a task back to the backlog (task context menu). The shared helper lifts the task's text + materialized association into a fresh
	// entry and commits the day removal + backlog append as one optimistic unit.
	function onMoveToBacklog(task: ResolvedTask) {
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		moveTaskToBacklog(
			index,
			settings.backlogPath,
			task.date,
			day.path,
			task.block,
			task,
		);
	}

	// ── Row label context menu (#11) ──
	// A project row offers the same project items as the Projects page (shared
	// via projectMenu.ts): "Change domain", and — under a domain — "Show on
	// domain's row". A rolled-up project has no row of its own, so the domain
	// row's menu carries one submenu per rolled-up project with "Give its own
	// row" and "Change domain". Writes go through projectActions → the index,
	// which republishes, so the rows rebuild on their own.
	function openRowMenu(row: GridRow, e: MouseEvent) {
		if (!snapshot || row.kind === "unassigned") return;
		const snap = snapshot;
		const menu = new Menu();
		if (row.kind === "project") {
			const project = snap.projects.get(row.name);
			if (!project) return;
			addChangeDomainItem(menu, index, project, snap.domains.values());
			addRollupItem(menu, index, project);
		} else {
			const domain = snap.domains.get(row.name);
			const rolled = domain ? rolledUpProjects(domain, snap) : [];
			if (rolled.length === 0) return;
			for (const project of rolled) {
				menu.addItem((item) => {
					item.setTitle(project.name).setIcon("folder");
					const sub = submenuOf(item);
					addRollupItem(sub, index, project);
					addChangeDomainItem(sub, index, project, snap.domains.values());
				});
			}
		}
		e.preventDefault();
		e.stopPropagation();
		menu.showAtMouseEvent(e);
	}

	function onNavigate(assoc: Association) {
		navigateToAssociation(app, resolve(assoc));
	}

	// Jump to a nested task's block in the Day view (badge click).
	function onReveal(task: ResolvedTask) {
		reveal(task.date, task.block.source.line);
	}

	// A "+" opens a field in its cell for the new task instead of making a
	// "New task" at once (DraftTask), so nothing is made until it has a name.
	let draft = $state<{ rowKey: GridRow["key"]; date: ISODate } | null>(null);
	function draftInCell(row: GridRow, date: ISODate): boolean {
		return draft?.rowKey === row.key && draft.date === date;
	}
	// With Unscheduled behind the header badge, the badge pulses when a task
	// typed in a cell lands in it, to show where it went.
	let pulsed = $state<ISODate | null>(null);
	let pulseTimer: number | undefined;
	function pulse(date: ISODate) {
		window.clearTimeout(pulseTimer);
		pulsed = null;
		requestAnimationFrame(() => {
			pulsed = date;
			pulseTimer = window.setTimeout(() => (pulsed = null), 900);
		});
	}

	function onCreate(row: GridRow, date: ISODate) {
		focusDay(date);
		draft = { rowKey: row.key, date };
	}

	// A popup group's "+": a typed task in that day's Unscheduled, filed under
	// the group.
	async function addUnscheduled(
		date: ISODate,
		text: string,
		assoc: Association | undefined,
	) {
		const day = dayOf(date);
		const path = day?.path ?? (await ensureNoteForDate(date));
		const blocks = dayOf(date)?.blocks ?? day?.blocks ?? [];
		commit(date, path, addTaskToUnscheduled(blocks, path, text, assoc, nextDraftLine()));
		pulse(date);
	}

	async function addDraft(row: GridRow, date: ISODate, text: string) {
		const assoc = rowAssociation(row);
		const day = dayOf(date);
		const path = day?.path ?? (await ensureNoteForDate(date));
		const blocks = dayOf(date)?.blocks ?? day?.blocks ?? [];
		commit(date, path, addTaskToUnscheduled(blocks, path, text, assoc, nextDraftLine()));
	}

	// A group's "+" (grouping on): a new task in that block, filed under the row
	// it was added from. Unscheduled's adds to Unscheduled, like the cell's "+".
	async function onCreateInBlock(row: GridRow, date: ISODate, block: Block) {
		if (isUnscheduledBlock(block)) {
			await onCreate(row, date);
			return;
		}
		focusDay(date);
		const day = dayOf(date);
		if (!day || day.path === null) return;
		commit(
			date,
			day.path,
			addTaskToBlock(day.blocks, block, "New task", rowAssociation(row), nextDraftLine()),
		);
	}

	// ── Task drag-to-reschedule (grid DnD) ──
	// Long-press on a task body starts a drag. The ghost follows the pointer; the
	// hovered cell's (date, rowKey) is tracked as the live drop target. On release:
	//   • Same day → unnest + re-associate within that day.
	//   • Different day → cross-day move via moveTaskAcrossDays.
	//   • Over a Day or Week timeline → schedule it there (taskDrop.ts): into a
	//     block at the marked slot, or a new block on empty time. Leaves share
	//     one document, so the timeline's DOM is hit-testable from here.
	// The grid drags *resolved* tasks: the drop handler needs the task's date to
	// find the day it came from, which the shared (timeline) drag state — where a
	// column already knows its own date — doesn't carry.
	type GridTaskDrag = Omit<TaskDragState, "task"> & { task: ResolvedTask };
	let taskDrag = $state<GridTaskDrag | null>(null);
	let taskDrop = $state<GridDropSlot | null>(null);
	// The block group under the pointer (grouping on): a drop there nests the
	// task in that block, or takes it out of its block on Unscheduled. Takes
	// precedence over the cell the group sits in.
	let groupDrop = $state<GridGroupDrop | null>(null);
	// The timeline position under the pointer, when it's over a Day/Week view.
	// Takes precedence over a grid cell (the two never overlap on screen).
	let timelineDrop = $state<TimelineDrop | null>(null);
	// Last pointer coordinates, updated on every pointermove during a drag.
	// Re-hit-tested at pointerup to get the freshest drop slot.
	let lastPointerX = 0;
	let lastPointerY = 0;
	// Scrolls the grid (or a timeline the drag is over) near its edge, for a
	// task or a block drag (see dragScroll.ts).
	let dragScroll: DragScroll | undefined;
	function stopDragScroll() {
		dragScroll?.stop();
		dragScroll = undefined;
	}

	function onTaskGrab(task: ResolvedTask, event: PointerEvent) {
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
		taskDrag = {
			owner: task.block,
			task,
			ghostX: event.clientX,
			ghostY: event.clientY,
			label: task.text,
			duplicate: event.ctrlKey || event.metaKey,
		};
		// Show the task's day in the Day view, so its blocks are there to drop on.
		focusDay(task.date);
		hitTestDrag(event);
		dragScroll?.stop();
		dragScroll = startDragScroll(event, onTaskDragMove);
	}

	function onTaskDragMove(event: PointerEvent) {
		if (!taskDrag) return;
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
		taskDrag = {
			...taskDrag,
			ghostX: event.clientX,
			ghostY: event.clientY,
			duplicate: event.ctrlKey || event.metaKey,
		};
		hitTestDrag(event);
		dragScroll?.update(event);
	}

	// Find what's under the pointer — a timeline first, then a block group, else
	// a grid cell — and publish the drag so every timeline can draw where it
	// would land.
	function hitTestDrag(event: PointerEvent) {
		const drag = taskDrag;
		if (!drag) return;
		timelineDrop = hitTestTimeline(event);
		groupDrop = timelineDrop ? null : hitTestGridGroup(event);
		taskDrop = timelineDrop || groupDrop ? null : hitTestGridCell(event);
		springLoad(event);
		links.setDrag({
			from: { date: drag.task.date, line: drag.task.source.line },
			// A Grid block group lands in that block, so the timelines show it too.
			drop: timelineDrop ?? groupDrop?.drop ?? null,
			label: newBlockLabel(drag.task, drag.owner, dropMods(drag)),
			duplicate: drag.duplicate,
		});
	}

	// What a drop applies: the drag's modifiers plus the block-name setting.
	function dropMods(drag: GridTaskDrag) {
		return { duplicate: drag.duplicate, blockTitle: settings.dropBlockTitle };
	}

	// Holding a drag on a column header shows that day in the Day view, so one
	// drag can reach another day's blocks in the sidebar.
	const SPRING_MS = 400;
	let springDate = $state<ISODate | null>(null);
	let springTimer: number | null = null;
	function springLoad(event: PointerEvent) {
		const el = document.elementFromPoint(event.clientX, event.clientY);
		const head = el?.closest<HTMLElement>("[data-grid-head-date]");
		const date = head?.dataset.gridHeadDate ?? null;
		if (date === springDate) return;
		clearSpring();
		springDate = date;
		if (date) {
			// Holding on a header is a direct ask, so it works with follow off.
			// Only while a Day view is open: an unanswered explicit request would
			// otherwise wait and move the next Day view that opens.
			springTimer = window.setTimeout(() => {
				if (dayViewDate !== null) links.focus(date, true);
			}, SPRING_MS);
		}
	}
	function clearSpring() {
		if (springTimer !== null) window.clearTimeout(springTimer);
		springTimer = null;
		springDate = null;
	}

	function endTaskDrag() {
		taskDrag = null;
		taskDrop = null;
		groupDrop = null;
		timelineDrop = null;
		clearSpring();
		stopDragScroll();
		links.setDrag(null);
	}

	async function onTaskDragUp() {
		if (!taskDrag) return;
		const drag = taskDrag;
		// Re-hit-test at the exact release coordinates for the freshest slot —
		// taskDrop could be stale if no pointermove fired since entering this cell.
		const synth = new MouseEvent("pointermove", { clientX: lastPointerX, clientY: lastPointerY }) as PointerEvent;
		let onTimeline = hitTestTimeline(synth);
		let onGroup = onTimeline ? null : hitTestGridGroup(synth);
		let drop = onTimeline || onGroup ? null : hitTestGridCell(synth);
		// Nothing under the release point: use the last position seen.
		if (!onTimeline && !onGroup && !drop) {
			onTimeline = timelineDrop;
			onGroup = groupDrop;
			drop = taskDrop;
		}
		endTaskDrag();

		// Released over a timeline: schedule it there.
		if (onTimeline) {
			void dropTaskOnTimeline(index, drag.task.date, drag.owner, drag.task, onTimeline, dropMods(drag));
			return;
		}
		if (onGroup) {
			void dropOnGroup(drag, onGroup);
			return;
		}
		if (!drop) return;

		const sourceDay = dayOf(drag.task.date);
		if (!sourceDay || sourceDay.path === null) return;

		// Resolve the target row's association from the drop's row key.
		const targetRow = rows.find((r) => r.key === drop.rowKey);
		// Never drop into a read-only history cell (row inactive/archived that day).
		if (targetRow && isCellInactive(targetRow, drop.date as ISODate)) return;
		// A different row re-files the task to that row's association (null =
		// unassigned, clear it). The row it already renders on keeps its own
		// association — on a rolled-up domain row that's the task's project, not
		// the domain (see `dropAssociation`). Undefined = no row found, preserve.
		const target = snapshot
			? dropAssociation(targetRow, drag.task.owner, snapshot)
			: undefined;
		const newAssoc: Association | null | undefined = target?.assoc;
		const sameRow = target?.sameRow ?? false;

		// Ctrl/Cmd-drag: drop a copy into the target cell's Unscheduled, leaving
		// the source task untouched. Same-day and cross-day collapse to one path —
		// the source day is never modified, so we only write the target day.
		if (drag.duplicate) {
			const targetDay = dayOf(drop.date as ISODate);
			const targetPath = targetDay?.path ?? (await ensureNoteForDate(drop.date as ISODate));
			const targetBlocks = targetDay?.blocks ?? [];
			const next = copyTaskIntoDay(
				targetBlocks,
				drag.task,
				targetPath,
				nextDraftLine(),
				newAssoc,
			);
			commit(drop.date as ISODate, targetPath, next);
			return;
		}

		if (drop.date === drag.task.date) {
			// Same day, same row: dropped back where it was. Nothing to re-file.
			if (sameRow) return;
			// Same day, different row: this is a *re-filing*, not a move. Only the
			// task's association changes — it stays in whatever block it lives in.
			// You schedule blocks, not tasks, so changing a task's owner must not
			// quietly unschedule it out of its block and into Unscheduled.
			if (newAssoc === undefined) return; // no target row resolved

			const owner = sourceDay.blocks.find(
				(b) => b.source.line === drag.owner.source.line,
			);

			// The one case that still has to move: "Unassigned" can't be expressed
			// while the task sits in a block carrying its own association, because
			// clearing the task's tag just re-inherits the block's (spec §2.2). To
			// land in that row the task has to leave the block — and then the
			// association `unnestTask` materializes onto it has to be cleared again.
			if (newAssoc === null && owner?.assoc) {
				const moved = unnestTask(
					sourceDay.blocks,
					drag.owner,
					drag.task,
					sourceDay.path,
				);
				if (moved === sourceDay.blocks) return;
				commit(
					drag.task.date,
					sourceDay.path,
					applyAssocToTask(moved, drag.task, null),
				);
				return;
			}

			commit(
				drag.task.date,
				sourceDay.path,
				applyAssocToTask(sourceDay.blocks, drag.task, newAssoc),
			);
			return;
		}

		// Cross-day move: remove from source, append to target day's Unscheduled
		// with the target row's association applied.
		const targetDay = dayOf(drop.date as ISODate);
		const targetPath = targetDay?.path ?? (await ensureNoteForDate(drop.date as ISODate));
		const targetBlocks = targetDay?.blocks ?? [];
		const { from, to } = moveTaskAcrossDays(
			sourceDay.blocks,
			targetBlocks,
			drag.owner,
			drag.task,
			targetPath,
			nextDraftLine(),
			newAssoc,
		);
		index.applyCrossDayMove(
			drag.task.date,
			sourceDay.path,
			from,
			drop.date as ISODate,
			targetPath,
			to,
		);
	}

	// Released on a block group: the task lands in that block (or Unscheduled),
	// on that day and in that row. Where you drop says both when (the block) and
	// what (the row): a different row re-files it like a cell drop does, the row
	// it's already on keeps its association. Ctrl/Cmd drops a copy.
	async function dropOnGroup(drag: GridTaskDrag, at: GridGroupDrop) {
		const targetRow = rows.find((r) => r.key === at.rowKey);
		if (!targetRow || !snapshot) return;
		// Never drop into a read-only history cell (row inactive/archived that day).
		if (isCellInactive(targetRow, at.drop.date)) return;
		const target = dropAssociation(targetRow, drag.task.owner, snapshot);
		const assoc = target && !target.sameRow ? target.assoc : undefined;
		// Dropped back on its own group: nothing to do.
		const sameDay = at.drop.date === drag.task.date;
		const ownGroup =
			at.drop.kind === "block"
				? at.drop.blockLine === drag.owner.source.line
				: at.drop.kind === "unscheduled" && isUnscheduledBlock(drag.owner);
		if (sameDay && ownGroup && assoc === undefined && !drag.duplicate) return;
		await dropTaskOnTimeline(
			index,
			drag.task.date,
			drag.owner,
			drag.task,
			at.drop,
			{ duplicate: drag.duplicate },
			assoc,
		);
	}

	// Set (or clear) a nested task's own association, wherever it currently sits.
	// Walks the blocks to find the task by source line and updates its assoc field;
	// everything else about the task — and its place in its block — is untouched.
	function applyAssocToTask(blocks: Block[], task: Task, assoc: Association | null): Block[] {
		return blocks.map((b) => ({
			...b,
			tasks: b.tasks.map((t) => {
				if (t.source.line !== task.source.line) return t;
				if (assoc) return { ...t, assoc };
				const { assoc: _drop, ...rest } = t;
				return rest;
			}),
		}));
	}

	function cancelTaskDrag() {
		endTaskDrag();
	}

	// ── Block drag (grid block DnD) ──
	// Long-press on a block's header lifts the
	// whole block — its time, title, and all child tasks — and drops it onto a
	// new (date, row).
	// Same-day drop: association-only change via setBlockAssoc.
	// Cross-day drop: full block move via moveBlockAcrossDays + applyCrossDayMove.
	let blockDrag = $state<BlockDragState | null>(null);
	let blockDrop = $state<GridDropSlot | null>(null);

	function onBlockGrab(block: Block, date: ISODate, rowKey: string, event: PointerEvent) {
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
		const childCount = block.tasks.length;
		const label = childCount > 0 ? `${block.title} (+${childCount})` : block.title;
		// Stash the source date on the drag state so onBlockDragUp can find the day.
		blockDrag = {
			block,
			sourceDate: date,
			sourceRowKey: rowKey,
			ghostX: event.clientX,
			ghostY: event.clientY,
			label,
			duplicate: event.ctrlKey || event.metaKey,
		};
		blockDrop = hitTestGridCell(event);
		dragScroll?.stop();
		dragScroll = startDragScroll(event, onBlockDragMove);
	}

	function onBlockDragMove(event: PointerEvent) {
		if (!blockDrag) return;
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
		blockDrag = {
			...blockDrag,
			ghostX: event.clientX,
			ghostY: event.clientY,
			duplicate: event.ctrlKey || event.metaKey,
		};
		blockDrop = hitTestGridCell(event);
		dragScroll?.update(event);
	}

	async function onBlockDragUp() {
		if (!blockDrag) return;
		const drag = blockDrag;
		const synth = new MouseEvent("pointermove", { clientX: lastPointerX, clientY: lastPointerY }) as PointerEvent;
		const drop = hitTestGridCell(synth) ?? blockDrop;
		blockDrag = null;
		blockDrop = null;
		stopDragScroll();
		if (!drop) return;

		const sourceDate = drag.sourceDate as ISODate;
		const sourceDay = dayOf(sourceDate);
		if (!sourceDay || sourceDay.path === null) return;

		// Resolve the target row's association (same rule as a task drop: the row
		// the block already renders on keeps the block's own association, and so
		// does the row it was lifted from, which may only be a label row).
		const targetRow = rows.find((r) => r.key === drop.rowKey);
		// Never drop into a read-only history cell (row inactive/archived that day).
		if (targetRow && isCellInactive(targetRow, drop.date as ISODate)) return;
		const target = snapshot
			? blockDropAssociation(targetRow, drag.sourceRowKey, drag.block.assoc, snapshot)
			: undefined;
		const newAssoc: Association | null | undefined = target?.assoc;
		const sameRow = target?.sameRow ?? false;

		// Ctrl/Cmd-drag: drop a copy of the whole block (time, title, children)
		// onto the target day, leaving the source block in place. Same-day and
		// cross-day both just append a copy to the target — never touch the source.
		if (drag.duplicate) {
			const targetDay = dayOf(drop.date as ISODate);
			const targetPath = targetDay?.path ?? (await ensureNoteForDate(drop.date as ISODate));
			const targetBlocks = targetDay?.blocks ?? [];
			const next = copyBlockIntoDay(
				targetBlocks,
				drag.block,
				targetPath,
				undefined, // keep existing time
				newAssoc,
			);
			commit(drop.date as ISODate, targetPath, next);
			return;
		}

		if (drop.date === sourceDate) {
			// Same day: only the association changes.
			if (newAssoc === undefined || sameRow) return; // no row / no change
			const next = setBlockAssoc(sourceDay.blocks, drag.block, newAssoc);
			if (next !== sourceDay.blocks) commit(sourceDate, sourceDay.path, next);
			return;
		}

		// Cross-day: move the whole block (time, title, children) to the target day.
		const targetDay = dayOf(drop.date as ISODate);
		const targetPath = targetDay?.path ?? (await ensureNoteForDate(drop.date as ISODate));
		const targetBlocks = targetDay?.blocks ?? [];
		const { from, to } = moveBlockAcrossDays(
			sourceDay.blocks,
			targetBlocks,
			drag.block,
			targetPath,
			undefined, // keep existing time
			newAssoc,
		);
		index.applyCrossDayMove(
			sourceDate,
			sourceDay.path,
			from,
			drop.date as ISODate,
			targetPath,
			to,
		);
	}

	function cancelBlockDrag() {
		blockDrag = null;
		blockDrop = null;
		stopDragScroll();
	}

	// True when the given cell (date + row) is the live drop target for either
	// a task drag or a block drag.
	function isDropTargetFor(date: ISODate, rowKey: string): boolean {
		if (taskDrop && taskDrop.date === date && taskDrop.rowKey === rowKey) return true;
		if (blockDrop && blockDrop.date === date && blockDrop.rowKey === rowKey) return true;
		return false;
	}

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}

	// ── Association picker (parent-owned so it isn't clipped by a cell) ──
	// It edits a task's association, or a block's (from its header), like the
	// Day and Week views' pickers.
	type PickerTarget =
		| { kind: "task"; task: ResolvedTask }
		| { kind: "block"; date: ISODate; block: Block };
	let pickerTarget = $state<PickerTarget | null>(null);
	let pickerAnchor = $state<DOMRect | null>(null);
	const pickerCurrent = $derived(
		pickerTarget?.kind === "block" ? pickerTarget.block.assoc : pickerTarget?.task.assoc,
	);

	function openTaskAssoc(task: ResolvedTask, anchor: DOMRect) {
		focusDay(task.date);
		pickerTarget = { kind: "task", task };
		pickerAnchor = anchor;
	}
	function openBlockAssoc(date: ISODate, block: Block, anchor: DOMRect) {
		focusDay(date);
		pickerTarget = { kind: "block", date, block };
		pickerAnchor = anchor;
	}
	function closeAssocPicker() {
		pickerTarget = null;
		pickerAnchor = null;
	}
	function onPickAssoc(assoc: Association | null) {
		const target = pickerTarget;
		closeAssocPicker();
		if (!target) return;
		if (target.kind === "block") {
			const { block } = target;
			editBlock(target.date, (blocks) => setBlockAssoc(blocks, block, assoc));
			return;
		}
		const { task } = target;
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		// Reassociation is a per-task field edit: rebuild the day's blocks with the
		// task's assoc set (or cleared) and commit. We map over the blocks here
		// rather than adding a writer helper, mirroring how the timeline applies it.
		const blocks = day.blocks.map((b) => {
			if (b.source.line !== task.block.source.line) return b;
			return {
				...b,
				tasks: b.tasks.map((t) =>
					t.source.line === task.source.line
						? assoc
							? { ...t, assoc }
							: stripAssoc(t)
						: t,
				),
			};
		});
		commit(task.date, day.path, blocks);
	}

	function stripAssoc<T extends { assoc?: Association }>(x: T): T {
		const { assoc: _drop, ...rest } = x;
		return rest as T;
	}

	// ── Block picker ("change parent block" — parent-owned like the assoc one) ──
	// Opened from a nested task's context menu; picking a block moves the task into
	// it via nestTaskUnderBlock. Held here (not in the cell) so it isn't clipped.
	let blockPickerTask = $state<ResolvedTask | null>(null);
	let blockPickerAnchor = $state<DOMRect | null>(null);

	// The candidate blocks for the picked task's day, minus its current owner
	// (nesting where it already lives is a no-op the picker shouldn't offer).
	const blockPickerOptions = $derived.by<BlockOption[]>(() => {
		if (!blockPickerTask) return [];
		const day = dayOf(blockPickerTask.date);
		return day ? blockOptions(day.blocks, blockPickerTask.block.source.line) : [];
	});

	function openBlockPicker(task: ResolvedTask, anchor: DOMRect) {
		// Show the day in the Day view too, so the blocks you're choosing between
		// are on screen.
		focusDay(task.date);
		blockPickerTask = task;
		blockPickerAnchor = anchor;
	}
	function closeBlockPicker() {
		blockPickerTask = null;
		blockPickerAnchor = null;
	}
	function onPickBlock(option: BlockOption) {
		const task = blockPickerTask;
		closeBlockPicker();
		if (!task) return;
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		commit(
			task.date,
			day.path,
			nestTaskUnderBlock(day.blocks, task.block, task, option.block),
		);
	}

	// ── Header popovers (calendar + span controls) ──
	let showCalendar = $state(false);
	let calendarValue = $state<Date>(dateFromISO(todayISO()));
	let dateNavRef = $state<HTMLDivElement>();
	let showControls = $state(false);
	let controlsRef = $state<HTMLDivElement>();

	function setDaysBefore(value: number) {
		updateSettings((s) => {
			s.weekDaysBefore = clampSpan(value);
		});
	}
	function setDaysAfter(value: number) {
		updateSettings((s) => {
			s.weekDaysAfter = clampSpan(value);
		});
	}

	function handleClickOutside(event: MouseEvent) {
		if (
			showControls &&
			controlsRef &&
			!controlsRef.contains(event.target as Node)
		) {
			showControls = false;
		}
		if (
			showCalendar &&
			dateNavRef &&
			!dateNavRef.contains(event.target as Node)
		) {
			showCalendar = false;
		}
	}
	function onCalendarSelect(picked: Date) {
		jumpTo(isoFromDate(picked));
	}

	async function openDayNote(date: ISODate) {
		const path = await ensureNoteForDate(date);
		const file = app.vault.getAbstractFileByPath(path);
		if (file) void app.workspace.getLeaf("tab").openFile(file as never);
	}

	// The grid's fixed template: a label column + one column per day.
	const gridTemplate = $derived(
		`var(--kairos-row-label-width) repeat(${windowSize}, minmax(0, 1fr))`,
	);

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			if (taskDrag) { event.preventDefault(); cancelTaskDrag(); }
			if (blockDrag) { event.preventDefault(); cancelBlockDrag(); }
		}
	}

	// The body scroll reserves a stable scrollbar gutter so its columns keep a
	// constant width. The header strip sits outside that scroll, so it reserves the
	// same trailing width — the measured scrollbar width, published as a CSS var on
	// the root — to stay column-aligned with the body below.
	let viewEl = $state<HTMLDivElement>();
	function measureScrollbar(el: HTMLElement) {
		const probe = document.createElement("div");
		probe.style.cssText =
			"position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;";
		el.appendChild(probe);
		const width = probe.offsetWidth - probe.clientWidth;
		probe.remove();
		el.style.setProperty("--gv-scrollbar", `${width}px`);
	}

	onMount(() => {
		if (viewEl) measureScrollbar(viewEl);
		const unsub = index.resolver().subscribe((r) => {
			resolve = r;
		});
		const unsubBacklog = index.backlog().subscribe((e) => {
			backlogEntries = e;
		});
		const unsubDayDate = links.dayDate$.subscribe((d) => {
			dayViewDate = d;
		});
		const unsubHover = links.hover$.subscribe((h) => {
			hovered = h;
		});

		const move = (e: PointerEvent) => {
			if (taskDrag) onTaskDragMove(e);
			if (blockDrag) onBlockDragMove(e);
		};
		const up = () => {
			if (taskDrag) void onTaskDragUp();
			if (blockDrag) void onBlockDragUp();
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);

		return () => {
			unsub();
			unsubBacklog();
			unsubDayDate();
			unsubHover();
			if (taskDrag) endTaskDrag();
			stopDragScroll();
			unsubscribeGrid?.();
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
	});
</script>

<!-- The lists behind each day's header badges. -->
{#snippet listIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/></svg>
{/snippet}
{#snippet inboxIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
{/snippet}
{#snippet unscheduledList(tasks: ResolvedTask[], date: ISODate)}
	{#each groupByAssoc(tasks, (t) => t.owner, resolve) as group (group.key)}
		<AssocGroup
			assoc={group.assoc}
			resolved={group.resolved}
			count={group.items.length}
			{onNavigate}
			onAddText={(text: string) => addUnscheduled(date, text, group.assoc)}
			addLabel="Add a task here"
		>
		{#each group.items as task (task.source.line)}
			{@const r = task.owner ? resolve(task.owner) : undefined}
			<TaskRow
				{task}
				color={r?.color}
				association={task.owner}
				inherited={task.assoc === undefined && task.owner !== undefined}
				showAssociation={false}
				resolved={r}
				onNavigate={() => task.owner && onNavigate(task.owner)}
				onEditAssoc={(rect) => openTaskAssoc(task, rect)}
				onNest={(rect) => openBlockPicker(task, rect)}
				onMoveToBacklog={() => onMoveToBacklog(task)}
				onSetStatus={(_t, status) => onSetStatus(task, status)}
				onSetText={(_t, text) => onSetText(task, text)}
				onDelete={() => onDelete(task)}
				onGrab={(e) => onTaskGrab(task, e)}
				highlight={highlightOf(task)}
				onHoverChange={(on: boolean) => onTaskHover(task, on)}
			/>
		{/each}
		</AssocGroup>
	{/each}
{/snippet}
{#snippet inboxList(date: ISODate)}
	{@const lefts = leftoversOn(date)}
	{#if lefts.length > 0}
		<div class="inbox-left-head">
			<span>{$left$ ? leftOpenLabel($left$.from.date, $left$.today) : ""}</span>
			<span class="inbox-left-spacer"></span>
			<LeftoverButtons
				onLeave={() => $left$ && leftoverActions.leave($left$.today, $left$.from.date)}
				onBringAll={() => $left$ && leftoverActions.bring($left$.today, $left$.from.date)}
			/>
		</div>
		{#each lefts as l (l.task.source.line)}
			{@const la = l.task.assoc ?? l.owner.assoc}
			<LeftoverTask
				task={l.task}
				resolved={la ? resolve(la) : undefined}
				fromLabel={leftFrom}
				onDone={() => settleLeftover(l, "x")}
				onCancel={() => settleLeftover(l, "-")}
				onBring={() => bringLeftover(l)}
			/>
		{/each}
	{/if}
	{#each groupByAssoc(surfacedOnDate(date), (e) => e.assoc, resolve) as group (group.key)}
		<AssocGroup
			assoc={group.assoc}
			resolved={group.resolved}
			count={group.items.length}
			{onNavigate}
		>
		{#each group.items as entry (entry.source.line)}
			<BacklogNudge
				{entry}
				resolved={entry.assoc ? resolve(entry.assoc) : undefined}
				showAssociation={false}
				onInsert={(e) => onNudgeInsert(e, date)}
				onResurfaceTomorrow={onNudgeResurfaceTomorrow}
				onResurfaceAt={onNudgeResurfaceAt}
				{onNavigate}
			/>
		{/each}
		</AssocGroup>
	{/each}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="grid-view" bind:this={viewEl} onclick={handleClickOutside} onkeydown={onKeyDown} tabindex="-1">
	<div class="grid-header" use:intoViewHeader={viewHeader}>
		<div class="day-nav" bind:this={dateNavRef}>
			<button
				class="icon-btn nav-btn"
				onclick={(e) => {
					e.stopPropagation();
					stepWindow(-windowSize);
				}}
				aria-label="Previous window"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
			</button>
			<button
				class="day-date"
				title="Click to pick a date"
				onclick={(e) => {
					e.stopPropagation();
					showCalendar = !showCalendar;
				}}
			>
				{rangeLabel}
			</button>
			<button
				class="icon-btn nav-btn"
				onclick={(e) => {
					e.stopPropagation();
					stepWindow(windowSize);
				}}
				aria-label="Next window"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
			</button>
			{#if !atDefault}
				<button
					class="today-btn"
					onclick={(e) => {
						e.stopPropagation();
						goToday();
					}}>Today</button
				>
			{/if}
			{#if showCalendar}
				<div class="calendar-popup">
					<Datepicker inline bind:value={calendarValue} onselect={onCalendarSelect} />
				</div>
			{/if}
		</div>

		<span class="grid-header-spacer"></span>

		<div class="controls-wrap" bind:this={controlsRef}>
			<button
				class="icon-btn"
				onclick={(e) => {
					e.stopPropagation();
					showControls = !showControls;
				}}
				aria-label="Grid settings"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
			</button>
			{#if showControls}
				<div class="controls-popup">
					<label class="controls-field">
						<span class="controls-label">Days before today</span>
						<input type="number" class="controls-input" min="1" max="7" value={before} oninput={(e) => setDaysBefore(+e.currentTarget.value)} />
					</label>
					<label class="controls-field">
						<span class="controls-label">Days after today</span>
						<input type="number" class="controls-input" min="1" max="7" value={after} oninput={(e) => setDaysAfter(+e.currentTarget.value)} />
					</label>
					<label class="controls-field">
						<span class="controls-label">Show unscheduled tasks in the grid</span>
						<input type="checkbox" checked={settings.gridUnscheduledInCells} onchange={(e) => setUnscheduledInCells(e.currentTarget.checked)} />
					</label>
					<label class="controls-field">
						<span class="controls-label">Show projects on rolled-up tasks</span>
						<input type="checkbox" checked={settings.gridShowRollupProjects} onchange={(e) => setShowRollupProjects(e.currentTarget.checked)} />
					</label>
					<label class="controls-field">
						<span class="controls-label">Highlight across views</span>
						<input type="checkbox" checked={settings.highlightAcrossViews} onchange={(e) => setHighlightAcrossViews(e.currentTarget.checked)} />
					</label>
				</div>
			{/if}
		</div>
	</div>

	<!-- Header strip: corner + day columns. Fixed above the scroll so the vertical
	     scrollbar only runs alongside the body rows, not the date header. Reserves
	     the scrollbar gutter on its right so its columns line up with the body. -->
	<div class="grid-head" style={`grid-template-columns: ${gridTemplate};`}>
		<div class="grid-corner grid-corner-head"></div>
		{#each dates as date (date)}
			{@const offered = routinesByDate.get(date)}
			{@const usTasks = unscheduledOn(date)}
			{@const usBadge = !settings.gridUnscheduledInCells && usTasks.length > 0}
			{@const inCount = surfacedOnDate(date).length + leftoversOn(date).length}
			<div class="grid-colhead-wrap">
				<button
					class="grid-colhead date-card"
					class:today={isToday(date)}
					class:in-day={dayViewDate === date}
					class:spring={springDate === date}
					data-grid-head-date={date}
					title={dayViewDate === date
						? "Shown in the Day view · Ctrl+click to open the daily note"
						: "Click to show in the Day view · Ctrl+click to open the daily note"}
					onclick={(e) => {
						e.stopPropagation();
						if (e.ctrlKey || e.metaKey) void openDayNote(date);
						else showDay(date);
					}}
				>
					<span class="dow-label">{dowLabel(date)}</span>
					<span class="date-number">{dayNumber(date)}</span>
					{#if isToday(date)}
						<span class="today-indicator"></span>
					{/if}
					{#if dayViewDate === date}
						<span class="in-day-indicator" aria-label="Shown in the Day view"></span>
					{/if}
				</button>
				<!-- The day's lists as badges, bottom-right of its date cell:
				     Unscheduled, Inbox, then routines (listed on hover, each addable). -->
				{#if usBadge || inCount > 0 || (offered && offered.count > 0)}
					<div class="grid-badges">
						{#if usBadge}
							<span class="grid-badge-pulse" class:pulsed={pulsed === date}>
								<HeaderBadge
									title="Unscheduled"
									dateLabel={`${dowLabel(date)} ${dayNumber(date)}`}
									count={usTasks.length}
									icon={listIcon}
									bind:open={unscheduledOpen[date]}
									dragging={taskDrag !== null}
								>
									{@render unscheduledList(usTasks, date)}
								</HeaderBadge>
							</span>
						{/if}
						{#if inCount > 0}
							<HeaderBadge
								title="Inbox"
								dateLabel={`${dowLabel(date)} ${dayNumber(date)}`}
								count={inCount}
								icon={inboxIcon}
								tone={leftoversOn(date).length > 0 ? "warn" : "neutral"}
								dragging={taskDrag !== null}
							>
								{@render inboxList(date)}
							</HeaderBadge>
						{/if}
						{#if offered && offered.count > 0}
							<RoutinesAlert
								list={offered}
								variant="pill"
								label={dayLabel(date)}
								showAddAll={!settings.autoApplyRoutines}
								onAdd={(rs) => {
									focusDay(date);
									routineActions.insert(date, rs);
								}}
								onAddAll={() => {
									focusDay(date);
									routineActions.addAll(date);
								}}
							/>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="grid-scroll" data-drag-scroll>
		<div class="grid-table" style={`grid-template-columns: ${gridTemplate};`}>
			<!-- Body rows -->
			{#each rows as row, i (row.key)}
				{@const rowArchived = isCellInactive(row, todayISO())}
				<div
					class="grid-rowlabel"
					class:child={row.depth > 0}
					class:domain={row.kind === "domain"}
					class:unassigned={row.kind === "unassigned"}
					class:dim={rowArchived}
					class:group-end={isGroupEnd(i)}
					style={row.kind !== "unassigned" && "color" in row && row.color
						? `--row-accent: ${row.color};`
						: undefined}
					oncontextmenu={(e) => openRowMenu(row, e)}
				>
					{#if row.kind === "unassigned"}
						<span class="row-name" title={row.name}>{row.name}</span>
					{:else}
						<RowLabel info={labelInfo(row)} />
					{/if}
				</div>

				{#each dates as date (date)}
					{@const day = dayOf(date)}
					{@const inactive = isCellInactive(row, date)}
					{@const change = changeOn(row, date, inactive)}
					{@const intention = intentionOn(row, date, inactive)}
					<div
						class="grid-datacell"
						class:today={isToday(date)}
						data-grid-date={date}
						data-grid-row-key={row.key}
					>
						{#if change || intention}
							<span
								class="grid-cell-marks"
								style={"color" in row && row.color ? `color: ${row.color};` : undefined}
							>
								{#if intention}
									<!-- A new intention starts on this day; the tooltip reads it out. -->
									<span class="grid-intention-change" title={`Intention: ${intention}`}>
										<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M16 11.75V22"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M2 6h4"/><path d="M20 11.75V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h5.65"/><circle cx="18" cy="5" r="3"/></svg>
									</span>
								{/if}
								{#if change}
									<!-- Intensity moves on this day: an arrow and the new level. -->
									<span
										class="grid-intensity-change"
										title={`Intensity ${change.from ?? "unset"} → ${change.to} from this day`}
									>
										<span class="grid-intensity-arrow">{change.from === null || change.to > change.from ? "↑" : "↓"}</span>
										<IntensityBars level={change.to} />
									</span>
								{/if}
							</span>
						{/if}
						{#if day}
							{@const cell = cellFor(row, day)}
							<GridCell
								{resolve}
								color={"color" in row ? row.color : undefined}
								{inactive}
								onSetStatus={onSetStatus}
								onSetText={onSetText}
								onDelete={onDelete}
								onEditAssoc={openTaskAssoc}
								{onNavigate}
								{onReveal}
								onRevealBlock={(block: Block) => reveal(date, block.source.line)}
								onNest={openBlockPicker}
								{onMoveToBacklog}
								onCreate={() => onCreate(row, date)}
								draftOpen={draftInCell(row, date)}
								onDraftSubmit={(text: string) => void addDraft(row, date, text)}
								onDraftClose={() => (draft = null)}
								holdLanded={!settings.gridUnscheduledInCells}
								onLanded={() => pulse(date)}
								onTaskGrab={onTaskGrab}
								onBlockGrab={(block: Block, e: PointerEvent) => onBlockGrab(block, date, row.key, e)}
								onEditBlockAssoc={(block: Block, rect: DOMRect) => openBlockAssoc(date, block, rect)}
								onDeleteBlock={(block: Block) => onDeleteBlock(date, block)}
								onSetBlockTitle={(block: Block, title: string) => onSetBlockTitle(date, block, title)}
								dragTaskKey={taskDrag ? sourceKey(taskDrag.task.source) : undefined}
								dragBlockKey={blockDrag ? sourceKey(blockDrag.block.source) : undefined}
								isDropTarget={isDropTargetFor(date, row.key)}
								{highlightOf}
								onHover={onTaskHover}
								blockGroups={cell.blocks}
								chipFor={chipFor(row)}
								{date}
								dropGroup={dropGroupOn(date, row)}
								unscheduledSlot={wantsUnscheduledSlot(cell, inactive, date, row)}
								onCreateInBlock={(block: Block) => void onCreateInBlock(row, date, block)}
								{isBlockLinked}
								{onBlockHover}
							/>
						{:else}
							<div class="grid-datacell-empty"></div>
						{/if}
					</div>
				{/each}
			{/each}

			{#if rows.every((r) => r.kind === "unassigned")}
				<div class="grid-empty" style={`grid-column: 1 / span ${windowSize + 1};`}>
					No projects or domains yet. Create a project or domain file, or tag a task, to give it a row of its own.
				</div>
			{/if}
		</div>
	</div>
</div>

{#if pickerTarget && pickerAnchor}
	<AssociationPicker
		options={index.associationOptions()}
		create={(kind, name) => createAssociation(index, kind, name)}
		current={pickerCurrent}
		anchor={pickerAnchor}
		onPick={onPickAssoc}
		onClose={closeAssocPicker}
	/>
{/if}

{#if blockPickerTask && blockPickerAnchor}
	<BlockPicker
		colorOf={(o) => (o.block.assoc ? resolve(o.block.assoc).color : undefined)}
		options={blockPickerOptions}
		anchor={blockPickerAnchor}
		onPick={onPickBlock}
		onClose={closeBlockPicker}
	/>
{/if}

{#if resurfaceEntry && resurfaceAnchor}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="resurface-popup"
		use:portal
		bind:this={resurfacePopupEl}
		style={resurfaceStyle}
		onclick={(e) => e.stopPropagation()}
	>
		<Datepicker inline bind:value={resurfaceValue} onselect={onResurfaceAtSelect} />
	</div>
{/if}

{#if taskDrag}
	<div
		class="task-ghost"
		class:duplicating={taskDrag.duplicate}
		use:portal
		style={`left: ${taskDrag.ghostX + 12}px; top: ${taskDrag.ghostY + 8}px;`}
	>
		{#if taskDrag.duplicate}<span class="ghost-copy-badge">+</span>{/if}
		{taskDrag.label}
	</div>
{/if}

{#if blockDrag}
	<div
		class="task-ghost task-ghost-block"
		class:duplicating={blockDrag.duplicate}
		use:portal
		style={`left: ${blockDrag.ghostX + 12}px; top: ${blockDrag.ghostY + 8}px;`}
	>
		{#if blockDrag.duplicate}<span class="ghost-copy-badge">+</span>{/if}
		{blockDrag.label}
	</div>
{/if}

<style>
	.grid-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	/* ── Header (mirrors Week view controls) ── */
	.grid-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px 6px;
		flex-shrink: 0;
	}

	.day-nav {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.nav-btn {
		height: 24px;
		width: 24px;
	}

	.day-date {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-normal);
		font-variant-numeric: tabular-nums;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 3px 8px;
		cursor: pointer;
		white-space: nowrap;
	}
	.day-date:hover {
		background: var(--background-modifier-hover);
	}

	.today-btn {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--background-primary-alt);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 3px 8px;
		cursor: pointer;
	}
	.today-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.calendar-popup {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 100;
	}

	.grid-header-spacer {
		flex: 1;
	}

	.controls-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.icon-btn {
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary-alt);
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 26px;
		width: 26px;
		flex-shrink: 0;
	}
	.icon-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.icon-btn svg {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	.controls-popup {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		padding: 12px;
		box-shadow: var(--shadow-s);
		z-index: 100;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 170px;
	}
	.controls-field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.controls-label {
		font-size: 12px;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.controls-input {
		width: 56px;
		padding: 3px 6px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary-alt);
		color: var(--text-normal);
		font-size: 12px;
		text-align: center;
	}

	/* ── The grid table ── */
	/* The header strip is fixed above the scroll (so the vertical scrollbar runs
	   only alongside the body). It reserves the scrollbar's width on its right
	   (--gv-scrollbar) so its columns align with the body's, which reserves the
	   same width via `scrollbar-gutter: stable`. Rounds only its top corners; the
	   body table rounds its bottom corners, so together they read as one framed
	   table. */
	.grid-head {
		display: grid;
		flex-shrink: 0;
		margin: 0 10px;
		margin-right: calc(10px + var(--gv-scrollbar, 0px));
	}

	.grid-scroll {
		flex: 1;
		overflow: auto;
		/* Always reserve the scrollbar gutter so the body columns keep a constant
		   width and stay aligned with the fixed header strip above. */
		scrollbar-gutter: stable;
		padding: 0 10px 12px;
	}

	.grid-table {
		display: grid;
		border: 1px solid var(--background-modifier-border);
		border-radius: 0 0 8px 8px;
	}

	.grid-corner {
		background: var(--background-secondary);
		border-right: 1px solid var(--background-modifier-border);
		position: sticky;
		left: 0;
		z-index: 1;
	}
	/* The header-strip corner carries the header's bottom divider. */
	.grid-corner-head {
		border-bottom: 1px solid var(--background-modifier-border);
		border-radius: 8px 0 0 0;
		z-index: 3;
	}

	/* Holos-style date card: an uppercase day-of-week label over a large serif
	   day number, left-aligned, one per header-strip column. Kept identical to the
	   Week view's .col-head.date-card so the two headers read the same.

	   The two text lines flow normally in the button; the today underline is
	   absolutely positioned in the reserved bottom strip (padding-bottom) so it
	   never overlaps the number. */
	.grid-colhead.date-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		background: var(--background-secondary);
		border: none;
		border-bottom: 1px solid var(--background-modifier-border);
		border-left: 1px solid var(--background-modifier-border);
		padding: 8px 8px 12px 12px;
		/* Square, not Obsidian's button radius: the cards sit edge to edge on
		   their columns, and only the strip's outer top corners round (the
		   corner cell's, and the last card's below), like the Week view. */
		border-radius: 0;
		cursor: pointer;
		box-shadow: none;
		transition: filter 150ms ease;
		height: 100%;
	}
	.grid-colhead-wrap:last-child > .grid-colhead.date-card {
		border-top-right-radius: 8px;
	}
	.grid-colhead.date-card:hover {
		filter: brightness(1.15);
	}
	/* The date card's grid cell: holds the card plus the add-routines button,
	   which sits over the card's bottom-right corner. */
	.grid-colhead-wrap {
		position: relative;
		display: flex;
		min-width: 0;
	}
	.grid-colhead-wrap > .grid-colhead {
		flex: 1;
		min-width: 0;
	}
	.grid-badges {
		position: absolute;
		right: 6px;
		bottom: 6px;
		display: flex;
		align-items: center;
		gap: 3px;
	}

	/* The "Left open on …" heading inside a day's Inbox list. */
	.inbox-left-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-semibold);
		color: var(--color-orange);
	}

	.inbox-left-spacer {
		flex: 1;
	}

	.grid-colhead .dow-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 1px;
		line-height: 1.4;
	}
	.grid-colhead .date-number {
		font-family: Georgia, "Times New Roman", serif;
		font-size: 24px;
		font-weight: 400;
		color: var(--text-normal);
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.grid-colhead .today-indicator {
		position: absolute;
		left: 10%;
		bottom: 0px;
		width: 80%;
		height: 2px;
		background: var(--interactive-accent);
		border-radius: 1px;
	}
	.grid-colhead.today {
		background: color-mix(
			in srgb,
			var(--interactive-accent) 5%,
			var(--background-secondary)
		);
	}
	.grid-colhead.today .date-number {
		color: var(--interactive-accent);
	}

	/* The day the Day view is showing: a small dot in the card's top corner. */
	.grid-colhead .in-day-indicator {
		position: absolute;
		top: 5px;
		right: 6px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--interactive-accent);
	}
	/* A drag held on this header is about to show its day in the Day view. */
	.grid-colhead.spring {
		box-shadow: inset 0 0 0 2px var(--interactive-accent);
	}

	.grid-rowlabel {
		/* Top-left aligned content. The group accent is the row's left border
		   (a domain + its projects share the same accent color, so the border
		   reads as one continuous stripe down the group). */
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px var(--kairos-row-label-pad-right) 8px var(--kairos-row-label-pad-left);
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
		border-right: 1px solid var(--background-modifier-border);
		border-left: var(--kairos-row-label-accent-width) solid var(--row-accent, var(--text-faint));
		min-width: 0;
		position: sticky;
		left: 0;
		z-index: 1;
	}
	/* The Unassociated row has no association, so no accent border. */
	.grid-rowlabel.unassigned {
		border-left-color: transparent;
	}
	/* Child project rows sit deeper and share the domain's continuous accent, so
	   the divider between a domain and its children is dropped — the group reads as
	   one block. */
	.grid-rowlabel.child {
		padding-left: calc(var(--kairos-row-label-pad-left) + var(--kairos-row-label-indent));
	}
	.grid-rowlabel.child:not(.group-end),
	.grid-rowlabel.domain {
		border-bottom-color: transparent;
	}
	/* A row for an entity that is inactive/archived today — present for its
	   history, but dimmed to read as past (mirrors the Projects page). */
	.grid-rowlabel.dim {
		opacity: 0.5;
	}
	.grid-rowlabel.unassigned .row-name {
		color: var(--text-faint);
		font-style: italic;
	}

	.row-name {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}


	:global(.resurface-popup) {
		position: fixed;
		z-index: 1000;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: var(--shadow-s);
		padding: 4px;
	}

	.grid-datacell {
		/* Anchors the intensity-change marker. */
		position: relative;
		border-bottom: 1px solid var(--background-modifier-border);
		border-left: 1px solid var(--background-modifier-border);
		min-width: 0;
	}
	/* Where a row's intention or intensity changes: a notebook icon and/or a small
	   arrow with the intensity bars, in the row's accent, tucked in the cell's bottom-right
	   corner, under task action bars and the cell's "+" (both sit higher). */
	.grid-cell-marks {
		position: absolute;
		right: 4px;
		bottom: 2px;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--text-faint);
		font-size: 9px;
		line-height: 1;
		opacity: 0.85;
	}
	.grid-intention-change {
		display: inline-flex;
	}
	.grid-intensity-change {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.grid-intensity-arrow {
		margin-right: 1px;
	}
	/* Faint tint marking the currently active day's column. */
	.grid-datacell.today {
		background: color-mix(in srgb, var(--interactive-accent) 5%, transparent);
	}
	.grid-datacell-empty {
		height: 100%;
		min-height: 44px;
		background: repeating-linear-gradient(
			45deg,
			transparent,
			transparent 6px,
			var(--background-modifier-border) 6px,
			var(--background-modifier-border) 7px
		);
		opacity: 0.3;
	}

	.grid-empty {
		padding: 32px 16px;
		text-align: center;
		font-size: 13px;
		color: var(--text-muted);
	}

	/* Block drag ghost: same base as task ghost but with a filled accent border
	   to signal that the whole block (+ children) is being carried. */
	:global(.task-ghost-block) {
		border-color: var(--interactive-accent) !important;
		background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary)) !important;
	}

	/* Ctrl-drag duplicate: green-tinted frame + a leading "+" badge so the ghost
	   reads as "drop a copy" rather than "move". */
	:global(.task-ghost.duplicating) {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border-color: var(--color-green, #3aa675) !important;
	}
	:global(.ghost-copy-badge) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-green, #3aa675);
		color: var(--text-on-accent, #fff);
		font-size: 11px;
		font-weight: 700;
		line-height: 1;
	}

	/* The Unscheduled badge pulses when a task typed in a cell lands in it. */
	.grid-badge-pulse {
		display: contents;
	}
	.grid-badge-pulse.pulsed :global(.hb-trigger) {
		animation: grid-badge-pulse 900ms ease-out;
	}
	@keyframes grid-badge-pulse {
		0% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--interactive-accent) 70%, transparent);
			transform: scale(1);
		}
		25% {
			transform: scale(1.15);
		}
		100% {
			box-shadow: 0 0 0 8px transparent;
			transform: scale(1);
		}
	}
</style>
