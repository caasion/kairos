<script lang="ts">
	import { TFile } from "obsidian";
	import type { App } from "obsidian";
	import { onMount } from "svelte";
	import type { Unsubscriber } from "svelte/store";
	import { resolveBlocks } from "../../resolver";
	import type {
		Association,
		Block,
		Day,
		ISODate,
		ResolvedTask,
		Task,
		TaskStatus,
		TimeRange,
	} from "../../types";
	import { makeBlock, nestTaskUnderBlock } from "../../writer";
	import { daySignature, type KairosIndex, type Resolver } from "../../index";
	import { navigateToAssociation } from "../../navigate";
	import {
		hitTestDropSlot,
		type DropSlot,
		type TaskDragState,
		type UnscheduledItem,
	} from "./taskDrag";
	import {
		dateFromISO,
		ensureNoteForDate,
		notePathForDate,
		todayISO,
	} from "../../dayNote";
	import TimelineBlock from "./TimelineBlock.svelte";
	import TaskRow from "../task/Task.svelte";
	import {
		type Gesture,
		beginBlockGesture,
		beginCreateGesture,
		updateGesture,
	} from "./interactions";
	import {
		type TimelineGeometry,
		gridHeight,
		layoutBlocks,
		minutesToOffset,
	} from "./layout";

	// A single day's timeline column. Owns everything vertical for its date:
	// the day-store subscription, in-place write-back, and move/resize/create
	// gestures. The shared hour geometry (and gutter) live in the parent, so a
	// week of columns share one time axis.
	//
	// Cross-day drag is the parent's job: this column reports the start of a
	// block move via `onCrossDayGrab`, and the parent decides on drop whether the
	// block landed on another column. So a move gesture here is committed locally
	// only when the parent tells us the drop stayed in-column (default).

	interface Props {
		app: App;
		index: KairosIndex;
		date: ISODate;
		geo: TimelineGeometry;
		resolve: Resolver;
		// Opening the shared, parent-owned association picker.
		onEditAssoc: (date: ISODate, block: Block, anchor: DOMRect) => void;
		onEditTaskAssoc: (
			date: ISODate,
			block: Block,
			task: Task,
			anchor: DOMRect,
		) => void;
		// Forward a nest-under-block request up to the week-level block picker
		// (which escapes the column clip). The date routes the pick back here.
		onNestTask: (
			date: ISODate,
			owner: Block,
			task: Task,
			anchor: DOMRect,
		) => void;
		// A block move gesture began on this column. The parent begins tracking
		// the pointer's X to detect a cross-day drop; it calls back into
		// `takeBlock`/`isDropTarget` as needed. Returns nothing — the column keeps
		// previewing vertically until `onPointerUp` resolves the drop.
		onCrossDayGrab?: (date: ISODate, block: Block, event: PointerEvent) => void;
		// When false, the component skips rendering its own unscheduled section.
		// The parent is then responsible for rendering it (e.g. WeekView).
		showUnscheduled?: boolean;
		// Called whenever the unscheduled task list changes, so the parent can
		// render it outside this component (used by WeekView).
		onUnscheduledChange?: (date: ISODate, items: UnscheduledItem[]) => void;
	}

	let {
		app,
		index,
		date,
		geo,
		resolve,
		onEditAssoc,
		onEditTaskAssoc,
		onNestTask,
		onCrossDayGrab,
		showUnscheduled = true,
		onUnscheduledChange,
	}: Props = $props();

	function onNavigate(assoc: Association) {
		navigateToAssociation(app, resolve(assoc));
	}

	const bodyHeight = $derived(gridHeight(geo));

	let blocks = $state<Block[]>([]);
	let notePath = $state<string | null>(null);

	// Resolved tasks derive from `blocks`, so an in-place edit flows to render.
	const resolved = $derived(resolveBlocks(blocks, date));

	let unsubscribeDay: Unsubscriber | null = null;

	// (Re)point the column at `date`: resolve its note path and subscribe. Called
	// on mount and whenever `date` changes (a week-window shift reuses columns).
	function retarget(forDate: ISODate) {
		unsubscribeDay?.();
		unsubscribeDay = null;
		selection = new Set();
		preview = new Map();
		draft = null;
		notePath = notePathForDate(forDate);
		blocks = [];
		unsubscribeDay = index.day(forDate).subscribe((day) => adoptDay(day));
	}

	// Re-subscribe when the parent hands this column a new date.
	let lastDate = "";
	$effect(() => {
		if (date !== lastDate) {
			lastDate = date;
			retarget(date);
		}
	});

	function adoptDay(day: Day | undefined) {
		if (gesture) return;
		const incoming = day?.blocks ?? [];
		if (daySignature(incoming) === daySignature(blocks)) return;
		blocks = incoming;
	}

	// ── Write-back (identical model to DayView: mutate in place, then persist) ──

	function ownerFor(owner: Block): Block | undefined {
		return blocks.find((b) => b.source.line === owner.source.line);
	}

	function realTask(owner: Block, target: Task): Task | undefined {
		if (owner.status !== undefined && owner.source.line === target.source.line) {
			return undefined;
		}
		return owner.tasks.find((t) => t.source.line === target.source.line);
	}

	function writeToDisk() {
		if (notePath !== null) {
			index.applyDayEdit(date, notePath, blocks);
			return;
		}
		const forDate = date;
		void ensureNoteForDate(forDate).then((path) => {
			if (date === forDate) notePath = path;
			index.applyDayEdit(forDate, path, blocks);
		});
	}

	function handleBlockDelete(blockToDelete: Block) {
		const real = ownerFor(blockToDelete);
		if (!real) return;
		selection = new Set();
		blocks = blocks.filter((b) => b !== real);
		writeToDisk();
	}

	function handleSetTaskStatus(owner: Block, task: Task, status: TaskStatus) {
		const real = ownerFor(owner);
		if (!real) return;
		if (real.status !== undefined && real.source.line === task.source.line) {
			real.status = status;
		} else {
			const t = realTask(real, task);
			if (!t) return;
			t.status = status;
		}
		writeToDisk();
	}

	function handleSetTaskText(owner: Block, task: Task, text: string) {
		const real = ownerFor(owner);
		if (!real) return;
		if (real.status !== undefined && real.source.line === task.source.line) {
			real.title = text;
		} else {
			const t = realTask(real, task);
			if (!t) return;
			t.text = text;
		}
		writeToDisk();
	}

	function handleDeleteTask(owner: Block, task: Task) {
		const real = ownerFor(owner);
		if (!real) return;
		if (real.status !== undefined && real.source.line === task.source.line) {
			delete real.status;
			delete real.metadata;
		} else {
			real.tasks = real.tasks.filter((t) => t.source.line !== task.source.line);
		}
		writeToDisk();
	}

	function handleSetBlockTitle(block: Block, title: string) {
		const real = ownerFor(block);
		if (!real) return;
		real.title = title;
		writeToDisk();
	}

	function handleSetBlockTime(block: Block, time: TimeRange) {
		const real = ownerFor(block);
		if (!real) return;
		real.time = time;
		writeToDisk();
	}

	function handleSetBlockStatus(block: Block, status: TaskStatus) {
		const real = ownerFor(block);
		if (real?.status === undefined) return;
		real.status = status;
		writeToDisk();
	}

	function handleToggleBlockCheckable(block: Block) {
		const real = ownerFor(block);
		if (!real) return;
		if (real.status === undefined) real.status = " ";
		else {
			delete real.status;
			delete real.metadata;
		}
		writeToDisk();
	}

	let nextDraftLine = -2;
	function handleAddTask(block: Block) {
		const real = ownerFor(block);
		if (!real) return;
		const task: Task = {
			source: { path: real.source.path, line: nextDraftLine-- },
			text: "New task",
			status: " ",
		};
		real.tasks = [...real.tasks, task];
		writeToDisk();
	}

	// The picker is parent-owned (so it isn't clipped by a column); we just
	// forward requests up with our date attached.
	function openAssocPicker(block: Block, anchor: DOMRect) {
		onEditAssoc(date, block, anchor);
	}
	function openTaskAssocPicker(block: Block, task: Task, anchor: DOMRect) {
		onEditTaskAssoc(date, block, task, anchor);
	}
	function openBlockPicker(owner: Block, task: Task, anchor: DOMRect) {
		onNestTask(date, owner, task, anchor);
	}

	// Nest a task under `destination` at `index` (materialize-on-move lives in the
	// writer). Reassigns `blocks` from the whole-array transform, then persists.
	// Reached from drag-drop here and from the week-level block picker (which
	// routes back via the exported `applyNest`).
	function handleNestTask(
		owner: Block,
		task: Task,
		destination: Block,
		index?: number,
	) {
		const next = nestTaskUnderBlock(blocks, owner, task, destination, index);
		if (next === blocks) return;
		blocks = next;
		writeToDisk();
	}

	// The week-level block picker calls this after a pick (it holds the picker,
	// like applyBlockAssoc). Appends the task to the chosen block.
	export function applyNest(owner: Block, task: Task, destination: Block) {
		handleNestTask(owner, task, destination);
	}

	// Snapshot of this column's blocks as picker options, excluding an owner line.
	// Exported so the week view can build its block picker for our date.
	export function currentBlocksArray(): Block[] {
		return blocks;
	}

	// The parent applies association edits back through these (it holds the
	// picker). Exposed via the component's `takeBlock`-style API below.
	export function applyBlockAssoc(block: Block, assoc: Association | null) {
		const real = ownerFor(block);
		if (!real) return;
		if (assoc) real.assoc = assoc;
		else delete real.assoc;
		writeToDisk();
	}
	export function applyTaskAssoc(
		owner: Block,
		task: Task,
		assoc: Association | null,
	) {
		const real = ownerFor(owner);
		if (!real) return;
		if (real.status !== undefined && real.source.line === task.source.line) {
			if (assoc) real.assoc = assoc;
			else delete real.assoc;
		} else {
			const t = realTask(real, task);
			if (!t) return;
			if (assoc) t.assoc = assoc;
			else delete t.assoc;
		}
		writeToDisk();
	}

	const tasksBySource = $derived.by(() => {
		const map = new Map<number, ResolvedTask[]>();
		for (const block of blocks) map.set(block.source.line, []);
		for (const task of resolved) map.get(task.block.source.line)?.push(task);
		return map;
	});

	// The flat unscheduled list this column surfaces to WeekView. Derived (not an
	// effect) so it recomputes purely from `blocks`; the effect below only pushes
	// it up when its *content* actually changes, which breaks the render→effect→
	// render loop a naive effect would create.
	const unscheduledItems = $derived.by(() => {
		const items: UnscheduledItem[] = [];
		for (const block of unscheduled) {
			for (const task of tasksBySource.get(block.source.line) ?? []) {
				if (!task.colocated) items.push({ block, task });
			}
		}
		return items;
	});

	// A stable string over just the fields WeekView renders (prefixed with the
	// date so a week-window shift always looks changed), so we notify the parent
	// only on a genuine change — not on every re-derive that produces a fresh
	// array of the same content.
	const unscheduledSig = $derived(
		date +
			"\n" +
			unscheduledItems
				.map(
					({ task }) =>
						`${task.source.line}:${task.status}:${task.text}:${task.assoc?.id ?? task.owner?.id ?? ""}`,
				)
				.join("|"),
	);

	let lastUnscheduledSig = "";
	$effect(() => {
		// Read the signature to subscribe; guard on it so the effect is inert once
		// the content is unchanged (avoids the update-depth-exceeded loop).
		const sig = unscheduledSig;
		if (!onUnscheduledChange || sig === lastUnscheduledSig) return;
		lastUnscheduledSig = sig;
		onUnscheduledChange(date, unscheduledItems);
	});

	// ── Interaction state (vertical gestures within this day) ──

	let selection = $state<Set<Block>>(new Set());
	let gesture = $state<Gesture | null>(null);
	let preview = $state<Map<Block, TimeRange>>(new Map());
	let draft = $state<TimeRange | null>(null);
	let canvasEl = $state<HTMLDivElement>();

	// Task drag-to-nest, scoped to this column's own blocks (a week-wide task move
	// across days is a separate, larger gesture; here a task nests among the same
	// day's blocks). See taskDrag.ts for the hit-test contract.
	let taskDrag = $state<TaskDragState | null>(null);
	let taskDrop = $state<DropSlot | null>(null);

	const displayBlocks = $derived.by(() => {
		if (preview.size === 0) return blocks;
		return blocks.map((b) => {
			const time = preview.get(b);
			return time ? { ...b, time } : b;
		});
	});

	const placements = $derived(layoutBlocks(displayBlocks, geo));

	const selectedLines = $derived(
		new Set([...selection].map((b) => b.source.line)),
	);
	function isSelected(b: Block): boolean {
		return selectedLines.has(b.source.line);
	}

	const draftRect = $derived(
		draft
			? {
					top: minutesToOffset(draft.start, geo),
					height:
						minutesToOffset(draft.end, geo) -
						minutesToOffset(draft.start, geo),
				}
			: null,
	);

	const unscheduled = $derived(blocks.filter((b) => !b.scheduled));
	let unscheduledOpen = $state(true);

	// "now" needle only on today's column.
	const isToday = $derived(date === todayISO());
	let nowMinutes = $state(currentMinutes());
	function currentMinutes(): number {
		const d = new Date();
		return d.getHours() * 60 + d.getMinutes();
	}
	const needleTop = $derived(minutesToOffset(nowMinutes, geo));
	const needleVisible = $derived(
		isToday &&
			nowMinutes >= geo.startHour * 60 &&
			nowMinutes <= geo.endHour * 60,
	);

	// ── Gesture lifecycle ──

	function canvasOffset(event: PointerEvent): number {
		const rect = canvasEl?.getBoundingClientRect();
		return event.clientY - (rect?.top ?? 0);
	}

	const DRAG_THRESHOLD_PX = 3;
	let gestureOriginY = 0;
	let gestureMoved = false;

	function onBlockGestureStart(
		mode: "move" | "resize-top" | "resize-bottom",
		block: Block,
		event: PointerEvent,
	) {
		const additive = event.shiftKey || event.metaKey || event.ctrlKey;
		if (additive) {
			const next = new Set(selection);
			if (next.has(block)) next.delete(block);
			else next.add(block);
			selection = next;
		} else if (!selection.has(block)) {
			selection = new Set([block]);
		}

		const targets =
			mode === "move" && selection.size > 0 ? [...selection] : [block];
		gesture = beginBlockGesture(mode, targets, canvasOffset(event), geo);
		gestureOriginY = event.clientY;
		gestureMoved = false;

		// A single-block move is the only gesture that can leave the column, so
		// only then do we hand the parent a chance to track a cross-day drop.
		if (mode === "move" && targets.length === 1) {
			onCrossDayGrab?.(date, block, event);
		}
	}

	function onCanvasPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		if (gesture) return;
		selection = new Set();
		gesture = beginCreateGesture(canvasOffset(event), geo);
		gestureOriginY = event.clientY;
		gestureMoved = false;
	}

	// ── Task drag-to-nest ──
	// Long-press on a task body starts it. Clears any block gesture so the two
	// can't run at once. Move/up are driven by the parent's window listeners
	// (via handlePointerMove/handlePointerUp), which route to the drag first.
	function onTaskGrab(owner: Block, task: Task, event: PointerEvent) {
		gesture = null;
		preview = new Map();
		draft = null;
		selection = new Set();
		taskDrag = {
			owner,
			task,
			ghostX: event.clientX,
			ghostY: event.clientY,
			label: task.text,
		};
		taskDrop = hitTestDropSlot(event, canvasEl ? [canvasEl] : undefined);
	}

	export function cancelTaskDrag() {
		taskDrag = null;
		taskDrop = null;
	}

	// Parent forwards window pointer moves so a drag keeps tracking across
	// columns. Returns whether this column is handling a live gesture.
	export function handlePointerMove(event: PointerEvent): boolean {
		// A live task drag takes precedence over a block gesture (grabbing a task
		// clears any block gesture, so only one is ever live here).
		if (taskDrag) {
			taskDrag = { ...taskDrag, ghostX: event.clientX, ghostY: event.clientY };
			taskDrop = hitTestDropSlot(event, canvasEl ? [canvasEl] : undefined);
			return true;
		}
		if (!gesture) return false;
		if (
			!gestureMoved &&
			Math.abs(event.clientY - gestureOriginY) < DRAG_THRESHOLD_PX
		) {
			return true;
		}
		gestureMoved = true;
		const p = updateGesture(gesture, canvasOffset(event), notePath ?? "");
		preview = p.ranges;
		draft = p.draft ?? null;
		return true;
	}

	// The parent resolves pointer-up. If `crossDayDrop` is provided, this column
	// gives up the moved block instead of committing it locally. Returns the
	// block + its previewed range so the parent can hand it to the target day.
	export function handlePointerUp(): {
		block: Block;
		time: TimeRange;
	} | null {
		// Resolve a task drag first: it and a block gesture can't be live together.
		if (taskDrag) {
			const drag = taskDrag;
			const drop = taskDrop;
			taskDrag = null;
			taskDrop = null;
			if (drop) {
				const destination = blocks.find(
					(b) => b.source.line === drop.blockLine,
				);
				if (destination) {
					handleNestTask(drag.owner, drag.task, destination, drop.index);
				}
			}
			return null;
		}

		if (!gesture) return null;
		const g = gesture;
		const committedPreview = preview;
		const committedDraft = draft;
		const moved = gestureMoved;

		gesture = null;
		preview = new Map();
		draft = null;

		if (!moved) return null;

		if (g.mode === "create") {
			if (committedDraft) void commitCreate(committedDraft);
			return null;
		}

		// A single-block move is the cross-day candidate: return it (and its
		// previewed range) rather than committing, so the parent can decide.
		if (g.mode === "move" && g.grips.length === 1) {
			const grip = g.grips[0]!;
			const range = committedPreview.get(grip.block) ?? {
				start: grip.start,
				end: grip.end,
			};
			return { block: grip.block, time: range };
		}

		// Multi-move / resize always commit locally.
		if (committedPreview.size > 0) void commitRetime(committedPreview);
		return null;
	}

	// The parent calls this when a returned block's drop stayed in this column
	// (no cross-day move), to commit the vertical retime it deferred.
	export function commitLocalMove(block: Block, time: TimeRange) {
		const real = ownerFor(block);
		if (real) real.time = time;
		writeToDisk();
	}

	// The parent calls this on the SOURCE column to drop a block that moved to
	// another day: remove it locally and persist. The insertion into the target
	// day is applied atomically by the parent via index.applyCrossDayMove, so we
	// don't write here — we only update our local mirror so the block vanishes.
	export function removeBlockLocally(block: Block) {
		selection = new Set();
		blocks = blocks.filter((b) => b.source.line !== block.source.line);
	}

	// Snapshot for the parent's cross-day commit (it needs both days' arrays).
	export function currentBlocks(): Block[] {
		return blocks;
	}
	export function currentPath(): string | null {
		return notePath;
	}
	export async function ensurePath(): Promise<string> {
		const forDate = date;
		const path = notePath ?? (await ensureNoteForDate(forDate));
		if (date === forDate) notePath = path;
		return path;
	}

	async function commitCreate(range: TimeRange) {
		const forDate = date;
		const path = notePath ?? (await ensureNoteForDate(forDate));
		if (date !== forDate) return;
		notePath = path;
		// A unique negative line so two blocks created before the reparse don't
		// collide on the source line the keyed `{#each}` renders by (a duplicate
		// key freezes reconciliation). Shares the task draft-line counter so no
		// unsaved block and task collide either.
		const block = makeBlock(range, path, undefined, nextDraftLine--);
		blocks = [...blocks, block];
		writeToDisk();
	}

	async function commitRetime(ranges: Map<Block, TimeRange>) {
		for (const [previewBlock, time] of ranges) {
			const real = ownerFor(previewBlock);
			if (real) real.time = time;
		}
		writeToDisk();
	}

	async function deleteSelected() {
		if (selection.size === 0) return;
		const doomed = new Set([...selection].map((b) => b.source.line));
		selection = new Set();
		blocks = blocks.filter((b) => !doomed.has(b.source.line));
		writeToDisk();
	}

	// Exposed so the parent's key handler can delete the focused column's
	// selection (the parent tracks which column is focused).
	export function deleteSelection() {
		void deleteSelected();
	}
	export function clearSelection() {
		selection = new Set();
	}
	export function hasSelection(): boolean {
		return selection.size > 0;
	}

	async function openDayNote() {
		const path = await ensureNoteForDate(date);
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			void app.workspace.getLeaf("tab").openFile(file);
		}
	}
	export function openNote() {
		void openDayNote();
	}

	// ── Unscheduled data surface (for week-level rendering) ──────────────
	// WeekView suppresses the inline section (showUnscheduled=false) and calls
	// these to build its own per-column unscheduled strip above the scroll area.

	export function getUnscheduledBlocks(): Block[] {
		return unscheduled;
	}

	export function getUnscheduledTasks(blockLine: number): ResolvedTask[] {
		return (tasksBySource.get(blockLine) ?? []).filter((t) => !t.colocated);
	}

	export function resolveAssoc(assoc: Association) {
		return resolve(assoc);
	}

	export function setTaskStatus(owner: Block, task: Task, status: TaskStatus) {
		handleSetTaskStatus(owner, task, status);
	}

	export function setTaskText(owner: Block, task: Task, text: string) {
		handleSetTaskText(owner, task, text);
	}

	export function deleteTask(owner: Block, task: Task) {
		handleDeleteTask(owner, task);
	}

	export function grabTask(owner: Block, task: Task, event: PointerEvent) {
		onTaskGrab(owner, task, event);
	}

	export function editTaskAssoc(owner: Block, task: Task, anchor: DOMRect) {
		openTaskAssocPicker(owner, task, anchor);
	}

	export function nestTask(owner: Block, task: Task, anchor: DOMRect) {
		openBlockPicker(owner, task, anchor);
	}

	export function navigateAssoc(assoc: Association) {
		onNavigate(assoc);
	}

	// Portal the drag ghost to <body> so `position: fixed` escapes any transformed
	// leaf-container ancestor (same reason the pickers portal).
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			},
		};
	}

	onMount(() => {
		lastDate = date;
		retarget(date);
		const tick = window.setInterval(() => {
			nowMinutes = currentMinutes();
		}, 60_000);
		return () => {
			unsubscribeDay?.();
			window.clearInterval(tick);
		};
	});

	void dateFromISO; // retained import parity with DayView; harmless
</script>

{#if showUnscheduled && unscheduled.length > 0}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="col-unscheduled">
		<div
			class="us-header"
			class:open={unscheduledOpen}
			onclick={() => (unscheduledOpen = !unscheduledOpen)}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="us-chevron"><path d="m6 9 6 6 6-6"/></svg>
			<span>Unscheduled</span>
			<span class="us-count">{unscheduled.reduce((n, b) => n + (tasksBySource.get(b.source.line) ?? []).filter((t) => !t.colocated).length, 0)}</span>
		</div>
		{#if unscheduledOpen}
			{#each unscheduled as block (block.source.line)}
				{@const tasks = tasksBySource.get(block.source.line) ?? []}
				{#each tasks.filter((t) => !t.colocated) as task (task.source.line)}
					{@const r = task.owner ? resolve(task.owner) : undefined}
					<TaskRow
						{task}
						color={r?.color}
						association={task.assoc ?? task.owner}
						inherited={task.assoc === undefined && task.owner !== undefined}
						resolved={r}
						onNavigate={() => task.owner && onNavigate(task.owner)}
						onEditAssoc={(rect) => openTaskAssocPicker(block, task, rect)}
						onNest={(rect) => openBlockPicker(block, task, rect)}
						onSetStatus={(_t, status) => handleSetTaskStatus(block, task, status)}
						onSetText={(_t, text) => handleSetTaskText(block, task, text)}
						onDelete={(_t) => handleDeleteTask(block, task)}
						onGrab={(e) => onTaskGrab(block, task, e)}
					/>
				{/each}
			{/each}
		{/if}
	</div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="col-canvas-wrap" style={`height: ${bodyHeight}px;`}>
	<div
		class="col-canvas"
		class:creating={gesture?.mode === "create"}
		bind:this={canvasEl}
		onpointerdown={onCanvasPointerDown}
	>
		{#if needleVisible}
			<div class="col-needle" style={`top: ${needleTop}px;`}></div>
		{/if}

		{#each placements as p (p.block.source.line)}
			<TimelineBlock
				block={p.block}
				tasks={tasksBySource.get(p.block.source.line) ?? []}
				top={p.top}
				height={p.height}
				column={p.column}
				lanes={p.lanes}
				selected={isSelected(p.block)}
				dragging={gesture !== null && isSelected(p.block)}
				{resolve}
				{onNavigate}
				onGestureStart={onBlockGestureStart}
				onDelete={handleBlockDelete}
				onSetTaskStatus={handleSetTaskStatus}
				onSetTaskText={handleSetTaskText}
				onDeleteTask={handleDeleteTask}
				onSetBlockTitle={handleSetBlockTitle}
				onSetBlockTime={handleSetBlockTime}
				onSetBlockStatus={handleSetBlockStatus}
				onToggleCheckable={handleToggleBlockCheckable}
				onAddTask={handleAddTask}
				onEditAssoc={openAssocPicker}
				onEditTaskAssoc={openTaskAssocPicker}
				onNestTask={openBlockPicker}
				onTaskGrab={onTaskGrab}
				dragTaskLine={taskDrag?.task.source.line}
				dropSlot={taskDrop ?? undefined}
				dragActive={taskDrag !== null}
			/>
		{/each}

		{#if draftRect}
			<div
				class="col-draft"
				style={`top: ${draftRect.top}px; height: ${draftRect.height}px;`}
			></div>
		{/if}
	</div>
</div>

{#if taskDrag}
	<!-- Drag ghost, portaled to body so fixed positioning matches the viewport. -->
	<div
		class="task-ghost"
		use:portal
		style={`left: ${taskDrag.ghostX + 12}px; top: ${taskDrag.ghostY + 8}px;`}
	>
		{taskDrag.label}
	</div>
{/if}

<style>
	/* Portaled drag ghost — global so it's styled outside the component subtree. */
	:global(.task-ghost) {
		position: fixed;
		z-index: 1000;
		pointer-events: none;
		max-width: 220px;
		padding: 3px 8px;
		font-size: 12px;
		color: var(--text-normal);
		background: var(--background-primary);
		border: 1px solid var(--interactive-accent);
		border-radius: 5px;
		box-shadow: var(--shadow-s);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 0.95;
	}

	.col-canvas-wrap {
		position: relative;
	}

	.col-canvas {
		position: relative;
		height: 100%;
		cursor: crosshair;
	}

	.col-draft {
		position: absolute;
		left: 2px;
		width: calc(92% - 4px);
		border: 1px dashed var(--interactive-accent);
		border-radius: 5px;
		background: var(--interactive-accent);
		opacity: 0.18;
		pointer-events: none;
		z-index: 4;
	}

	.col-needle {
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--color-red, var(--interactive-accent));
		z-index: 3;
		pointer-events: none;
	}

	.col-needle::before {
		content: "";
		position: absolute;
		left: -3px;
		top: -3px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-red, var(--interactive-accent));
	}

	/* ── Unscheduled (per column) ── */
	.col-unscheduled {
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.us-header {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		user-select: none;
	}

	.us-header:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.us-chevron {
		transition: transform 0.15s;
		transform: rotate(-90deg);
		flex-shrink: 0;
	}

	.us-header.open .us-chevron {
		transform: rotate(0deg);
	}

	.us-count {
		font-size: 10px;
		font-weight: 400;
		color: var(--text-faint);
		margin-left: 2px;
	}
</style>
