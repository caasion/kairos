<script lang="ts">
	// The Grid view — triage between tasks and their projects/domains (spec §5).
	//
	// Layout: rows = associations (projects, then domains, then unassigned),
	// columns = the visible days, cells = the tasks associated with that row on
	// that day. Domains are always fully expanded — every child project row is
	// always visible, no collapse state.
	//
	// Data comes from the index's reactive `grid(dates)` feed; the row model
	// (buildRows / cellTasks) is pure and lives in gridModel.ts. This component
	// owns the day window, the association picker, and the edit → index write
	// routing. Every task write rebuilds the affected day's blocks with a pure
	// writer transform and commits via `applyDayEdit`, exactly like the timeline.

	import type { App } from "obsidian";
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
		addTaskToUnscheduled,
		deleteTask,
		moveBlockAcrossDays,
		moveTaskAcrossDays,
		nestTaskUnderBlock,
		setBlockAssoc,
		setTaskStatus,
		setTaskText,
		unnestTask,
	} from "../../writer";
	import { blockOptions, type BlockOption } from "../../blockOptions";
	import type { GridDay, GridSnapshot, KairosIndex, Resolver } from "../../index";
	import { hitTestGridCell, type BlockDragState, type GridDropSlot, type TaskDragState } from "../timeline/taskDrag";
	import { navigateToAssociation } from "../../navigate";
	import {
		buildRows,
		cellTasks,
		rowAssociation,
		type GridRow,
	} from "../../gridModel";
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
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import BlockPicker from "../timeline/BlockPicker.svelte";
	import Datepicker from "../components/Datepicker.svelte";
	import BacklogNudge from "../backlog/BacklogNudge.svelte";
	import { placeUnderAnchor } from "../floating";

	interface Props {
		app: App;
		index: KairosIndex;
		settings$: Readable<KairosSettings>;
		updateSettings: (mutate: (s: KairosSettings) => void) => void;
		// Open the Day view and scroll to a block (a nested task's badge click).
		reveal: (date: ISODate, blockLine: number) => void;
	}

	let { app, index, settings$, updateSettings, reveal }: Props = $props();

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
	function columnLabel(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			weekday: "short",
			day: "numeric",
		});
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

	const rows = $derived<GridRow[]>(
		snapshot ? buildRows(snapshot) : [],
	);

	function tasksFor(row: GridRow, day: GridDay): ResolvedTask[] {
		return snapshot ? cellTasks(row, day.tasks, snapshot) : [];
	}

	// ── Resurfaced backlog nudges ──
	// Entries with a resurface date surface as nudges in one day's cell
	// (max(resurface, today)), under the row matching their association. An
	// untagged entry surfaces in the Unassociated row.
	let backlogEntries = $state<BacklogEntry[]>([]);

	// The nudges for a given (row, date): entries surfacing on `date` whose
	// association matches this row. Association match reuses the same canonical
	// resolution the row grouping uses, so an aliased tag lands in the right row.
	function nudgesFor(row: GridRow, date: ISODate): BacklogEntry[] {
		const due = surfacedOn(backlogEntries, date, todayISO());
		return due.filter((e) => rowMatchesEntry(row, e));
	}

	function rowMatchesEntry(row: GridRow, entry: BacklogEntry): boolean {
		if (!entry.assoc) return row.kind === "unassigned";
		if (row.kind === "unassigned") return false;
		if (row.kind !== entry.assoc.kind) return false;
		// Compare on canonical name so an alias-tagged entry matches its row.
		const name = snapshot
			? snapshot.resolve(entry.assoc).displayName || entry.assoc.id
			: entry.assoc.id;
		return name === row.name;
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
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		commit(
			task.date,
			day.path,
			setTaskStatus(day.blocks, task.block, task, status),
		);
	}
	function onSetText(task: ResolvedTask, text: string) {
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		commit(task.date, day.path, setTaskText(day.blocks, task.block, task, text));
	}
	function onDelete(task: ResolvedTask) {
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		commit(task.date, day.path, deleteTask(day.blocks, task.block, task));
	}

	// Send a task back to the backlog (task context menu). Only offered on genuine
	// nested tasks — a colocated task is a block, which can't leave its line.
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

	function onNavigate(assoc: Association) {
		navigateToAssociation(app, resolve(assoc));
	}

	// Jump to a nested task's block in the Day view (badge click).
	function onReveal(task: ResolvedTask) {
		reveal(task.date, task.block.source.line);
	}

	async function onCreate(row: GridRow, date: ISODate) {
		const assoc = rowAssociation(row);
		const day = dayOf(date);
		const path = day?.path ?? (await ensureNoteForDate(date));
		const blocks = day?.blocks ?? [];
		commit(
			date,
			path,
			addTaskToUnscheduled(blocks, path, "New task", assoc, nextDraftLine()),
		);
	}

	// ── Task drag-to-reschedule (grid DnD) ──
	// Long-press on a task body starts a drag. The ghost follows the pointer; the
	// hovered cell's (date, rowKey) is tracked as the live drop target. On release:
	//   • Same day → unnest + re-associate within that day.
	//   • Different day → cross-day move via moveTaskAcrossDays.
	// The grid drags *resolved* tasks: the drop handler needs the task's date to
	// find the day it came from, which the shared (timeline) drag state — where a
	// column already knows its own date — doesn't carry.
	type GridTaskDrag = Omit<TaskDragState, "task"> & { task: ResolvedTask };
	let taskDrag = $state<GridTaskDrag | null>(null);
	let taskDrop = $state<GridDropSlot | null>(null);
	// Last pointer coordinates, updated on every pointermove during a drag.
	// Re-hit-tested at pointerup to get the freshest drop slot.
	let lastPointerX = 0;
	let lastPointerY = 0;

	function onTaskGrab(task: ResolvedTask, event: PointerEvent) {
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
		taskDrag = {
			owner: task.block,
			task,
			ghostX: event.clientX,
			ghostY: event.clientY,
			label: task.text,
		};
		taskDrop = hitTestGridCell(event);
	}

	function onTaskDragMove(event: PointerEvent) {
		if (!taskDrag) return;
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
		taskDrag = { ...taskDrag, ghostX: event.clientX, ghostY: event.clientY };
		taskDrop = hitTestGridCell(event);
	}

	async function onTaskDragUp() {
		if (!taskDrag) return;
		const drag = taskDrag;
		// Re-hit-test at the exact release coordinates for the freshest slot —
		// taskDrop could be stale if no pointermove fired since entering this cell.
		const synth = new MouseEvent("pointermove", { clientX: lastPointerX, clientY: lastPointerY }) as PointerEvent;
		const drop = hitTestGridCell(synth) ?? taskDrop;
		taskDrag = null;
		taskDrop = null;
		if (!drop) return;

		const sourceDay = dayOf(drag.task.date);
		if (!sourceDay || sourceDay.path === null) return;

		// Resolve the target row's association from the drop's row key.
		const targetRow = rows.find((r) => r.key === drop.rowKey);
		const targetAssoc = targetRow ? rowAssociation(targetRow) : undefined;
		// Convert RowAssociation → Association (or null to clear).
		const newAssoc: Association | null | undefined = targetAssoc
			? { kind: targetAssoc.kind, id: targetAssoc.id }
			: targetAssoc === undefined
				? undefined  // no target row found — preserve existing assoc
				: null;      // unassigned row — clear assoc

		if (drop.date === drag.task.date) {
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
		taskDrag = null;
		taskDrop = null;
	}

	// ── Block drag (grid block DnD) ──
	// Long-press on a colocated task (checkable block) lifts the whole block —
	// its time, title, and all child tasks — and drops it onto a new (date, row).
	// Same-day drop: association-only change via setBlockAssoc.
	// Cross-day drop: full block move via moveBlockAcrossDays + applyCrossDayMove.
	let blockDrag = $state<BlockDragState | null>(null);
	let blockDrop = $state<GridDropSlot | null>(null);

	function onBlockGrab(task: ResolvedTask, event: PointerEvent) {
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
		const block = task.block;
		const childCount = block.tasks.length;
		const label = childCount > 0 ? `${block.title} (+${childCount})` : block.title;
		// Stash the source date on the drag state so onBlockDragUp can find the day.
		blockDrag = { block, sourceDate: task.date, ghostX: event.clientX, ghostY: event.clientY, label };
		blockDrop = hitTestGridCell(event);
	}

	function onBlockDragMove(event: PointerEvent) {
		if (!blockDrag) return;
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
		blockDrag = { ...blockDrag, ghostX: event.clientX, ghostY: event.clientY };
		blockDrop = hitTestGridCell(event);
	}

	async function onBlockDragUp() {
		if (!blockDrag) return;
		const drag = blockDrag;
		const synth = new MouseEvent("pointermove", { clientX: lastPointerX, clientY: lastPointerY }) as PointerEvent;
		const drop = hitTestGridCell(synth) ?? blockDrop;
		blockDrag = null;
		blockDrop = null;
		if (!drop) return;

		const sourceDate = drag.sourceDate as ISODate;
		const sourceDay = dayOf(sourceDate);
		if (!sourceDay || sourceDay.path === null) return;

		// Resolve the target row's association.
		const targetRow = rows.find((r) => r.key === drop.rowKey);
		const targetAssoc = targetRow ? rowAssociation(targetRow) : undefined;
		const newAssoc: Association | null | undefined = targetAssoc
			? { kind: targetAssoc.kind, id: targetAssoc.id }
			: targetAssoc === undefined
				? undefined
				: null; // unassigned row — clear assoc

		if (drop.date === sourceDate) {
			// Same day: only the association changes.
			if (newAssoc === undefined) return; // no valid target row
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
	let pickerTask = $state<ResolvedTask | null>(null);
	let pickerAnchor = $state<DOMRect | null>(null);

	function openTaskAssoc(task: ResolvedTask, anchor: DOMRect) {
		pickerTask = task;
		pickerAnchor = anchor;
	}
	function closeAssocPicker() {
		pickerTask = null;
		pickerAnchor = null;
	}
	function onPickAssoc(assoc: Association | null) {
		const task = pickerTask;
		closeAssocPicker();
		if (!task) return;
		const day = dayOf(task.date);
		if (!day || day.path === null) return;
		// Reassociation is a per-task field edit: rebuild the day's blocks with the
		// task's assoc set (or cleared) and commit. We map over the blocks here
		// rather than adding a writer helper, mirroring how the timeline applies it.
		const blocks = day.blocks.map((b) => {
			if (b.source.line !== task.block.source.line) return b;
			// Colocated task shares the block line.
			if (b.status !== undefined && b.source.line === task.source.line) {
				return assoc ? { ...b, assoc } : stripAssoc(b);
			}
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
		`180px repeat(${windowSize}, minmax(0, 1fr))`,
	);

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			if (taskDrag) { event.preventDefault(); cancelTaskDrag(); }
			if (blockDrag) { event.preventDefault(); cancelBlockDrag(); }
		}
	}

	onMount(() => {
		const unsub = index.resolver().subscribe((r) => {
			resolve = r;
		});
		const unsubBacklog = index.backlog().subscribe((e) => {
			backlogEntries = e;
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
			unsubscribeGrid?.();
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="grid-view" onclick={handleClickOutside} onkeydown={onKeyDown} tabindex="-1">
	<div class="grid-header">
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
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
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
				</div>
			{/if}
		</div>
	</div>

	<div class="grid-scroll">
		<div class="grid-table" style={`grid-template-columns: ${gridTemplate};`}>
			<!-- Header row: corner + day columns -->
			<div class="grid-corner"></div>
			{#each dates as date (date)}
				<button
					class="grid-colhead"
					class:today={isToday(date)}
					title="Open the daily note"
					onclick={(e) => {
						e.stopPropagation();
						void openDayNote(date);
					}}
				>
					{columnLabel(date)}
				</button>
			{/each}

			<!-- Body rows -->
			{#each rows as row (row.key)}
				<div
					class="grid-rowlabel"
					class:child={row.depth > 0}
					class:domain={row.kind === "domain"}
					class:unassigned={row.kind === "unassigned"}
				>
					{#if row.kind !== "unassigned"}
						<span
							class="row-accent"
							style={`background-color: ${("color" in row && row.color) || "var(--text-faint)"};`}
						></span>
					{/if}
					<span class="row-name" title={row.name}>{row.name}</span>
					{#if row.kind === "domain"}
						<!-- Domain icon — matches the association tag icon in task rows. -->
						<svg class="row-kind-icon" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
					{/if}
				</div>

				{#each dates as date (date)}
					{@const day = dayOf(date)}
					{@const nudges = nudgesFor(row, date)}
					<div
						class="grid-datacell"
						data-grid-date={date}
						data-grid-row-key={row.key}
					>
						{#if nudges.length > 0}
							<div class="grid-nudges">
								{#each nudges as entry (entry.source.line)}
									<BacklogNudge
										{entry}
										resolved={entry.assoc ? resolve(entry.assoc) : undefined}
										onInsert={(e) => onNudgeInsert(e, date)}
										onResurfaceTomorrow={onNudgeResurfaceTomorrow}
										onResurfaceAt={onNudgeResurfaceAt}
										{onNavigate}
									/>
								{/each}
							</div>
						{/if}
						{#if day}
							<GridCell
								tasks={tasksFor(row, day)}
								{resolve}
								color={"color" in row ? row.color : undefined}
								allowCreate={row.kind !== "unassigned" && row.kind !== "domain"}
								onSetStatus={onSetStatus}
								onSetText={onSetText}
								onDelete={onDelete}
								onEditAssoc={openTaskAssoc}
								{onNavigate}
								{onReveal}
								onNest={openBlockPicker}
								{onMoveToBacklog}
								onCreate={() => void onCreate(row, date)}
								onTaskGrab={onTaskGrab}
								onBlockGrab={onBlockGrab}
								dragTaskLine={taskDrag?.task.source.line}
								dragBlockLine={blockDrag?.block.source.line}
								isDropTarget={isDropTargetFor(date, row.key)}
							/>
						{:else if nudges.length === 0}
							<div class="grid-datacell-empty"></div>
						{/if}
					</div>
				{/each}
			{/each}

			{#if rows.length === 0}
				<div class="grid-empty" style={`grid-column: 1 / span ${windowSize + 1};`}>
					No projects or domains yet. Create a project or domain file, or tag a task, to see rows here.
				</div>
			{/if}
		</div>
	</div>
</div>

{#if pickerTask && pickerAnchor}
	<AssociationPicker
		options={index.associationOptions()}
		current={pickerTask.assoc}
		anchor={pickerAnchor}
		onPick={onPickAssoc}
		onClose={closeAssocPicker}
	/>
{/if}

{#if blockPickerTask && blockPickerAnchor}
	<BlockPicker
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
		use:portal
		style={`left: ${taskDrag.ghostX + 12}px; top: ${taskDrag.ghostY + 8}px;`}
	>
		{taskDrag.label}
	</div>
{/if}

{#if blockDrag}
	<div
		class="task-ghost task-ghost-block"
		use:portal
		style={`left: ${blockDrag.ghostX + 12}px; top: ${blockDrag.ghostY + 8}px;`}
	>
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
	.grid-scroll {
		flex: 1;
		overflow: auto;
		padding: 0 10px 12px;
	}

	.grid-table {
		display: grid;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		overflow: hidden;
	}

	.grid-corner {
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
		border-right: 1px solid var(--background-modifier-border);
		position: sticky;
		top: 0;
		left: 0;
		z-index: 3;
	}

	.grid-colhead {
		position: sticky;
		top: 0;
		z-index: 2;
		text-align: center;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--background-secondary);
		border: none;
		border-bottom: 1px solid var(--background-modifier-border);
		border-left: 1px solid var(--background-modifier-border);
		padding: 7px 4px;
		cursor: pointer;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.grid-colhead:hover {
		color: var(--text-normal);
	}
	.grid-colhead.today {
		color: var(--interactive-accent);
	}

	.grid-rowlabel {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
		border-right: 1px solid var(--background-modifier-border);
		min-width: 0;
		position: sticky;
		left: 0;
		z-index: 1;
	}
	.grid-rowlabel.child {
		padding-left: 22px;
		background: var(--background-secondary-alt);
	}
	.grid-rowlabel.unassigned .row-name {
		color: var(--text-faint);
		font-style: italic;
	}

	.row-accent {
		width: 3px;
		height: 16px;
		border-radius: 2px;
		flex-shrink: 0;
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

	.row-kind-icon {
		flex-shrink: 0;
		color: var(--text-faint);
	}

	.grid-nudges {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 4px;
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
		border-bottom: 1px solid var(--background-modifier-border);
		border-left: 1px solid var(--background-modifier-border);
		min-width: 0;
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
</style>
