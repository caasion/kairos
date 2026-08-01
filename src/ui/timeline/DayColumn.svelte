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
	import { makeBlock } from "../../writer";
	import { daySignature, type KairosIndex, type Resolver } from "../../index";
	import { navigateToAssociation } from "../../navigate";
	import {
		dateFromISO,
		ensureNoteForDate,
		notePathForDate,
		todayISO,
	} from "../../dayNote";
	import TimelineBlock from "./TimelineBlock.svelte";
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
		// A block move gesture began on this column. The parent begins tracking
		// the pointer's X to detect a cross-day drop; it calls back into
		// `takeBlock`/`isDropTarget` as needed. Returns nothing — the column keeps
		// previewing vertically until `onPointerUp` resolves the drop.
		onCrossDayGrab?: (date: ISODate, block: Block, event: PointerEvent) => void;
	}

	let {
		app,
		index,
		date,
		geo,
		resolve,
		onEditAssoc,
		onEditTaskAssoc,
		onCrossDayGrab,
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

	// ── Interaction state (vertical gestures within this day) ──

	let selection = $state<Set<Block>>(new Set());
	let gesture = $state<Gesture | null>(null);
	let preview = $state<Map<Block, TimeRange>>(new Map());
	let draft = $state<TimeRange | null>(null);
	let canvasEl = $state<HTMLDivElement>();

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

	// Parent forwards window pointer moves so a drag keeps tracking across
	// columns. Returns whether this column is handling a live gesture.
	export function handlePointerMove(event: PointerEvent): boolean {
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
		const block = makeBlock(range, path);
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

{#if unscheduled.length > 0}
	<div class="col-unscheduled">
		{#each unscheduled as block (block.source.line)}
			{@const tasks = tasksBySource.get(block.source.line) ?? []}
			<div class="us-block">
				<div class="us-title">{block.title}</div>
				{#each tasks.filter((t) => !t.colocated) as task (task.source.line)}
					{@const r = task.owner ? resolve(task.owner) : undefined}
					<div
						class="us-task"
						class:done={task.status === "x"}
						class:cancelled={task.status === "-"}
					>
						<span class="us-dot" class:half={task.status === "/"}></span>
						<span class="us-text">{task.text}</span>
						{#if task.owner && r}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								class="us-assoc"
								class:domain={task.owner.kind === "domain"}
								class:inherited={task.assoc === undefined}
								class:linked={r.resolved}
								title={r.resolved ? "Ctrl+click to open" : undefined}
								onclick={(e) => {
									if (e.ctrlKey || e.metaKey) {
										e.stopPropagation();
										onNavigate(task.owner!);
									}
								}}
							>
								{r.displayName}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	</div>
{/if}

<style>
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
		padding: 8px 6px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.us-block {
		border: 1px dashed var(--background-modifier-border);
		border-radius: 6px;
		padding: 6px 8px;
	}

	.us-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		margin-bottom: 4px;
	}

	.us-task {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		padding: 1px 0;
		min-width: 0;
	}

	.us-dot {
		flex-shrink: 0;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--text-muted);
	}

	.us-dot.half {
		background: var(--text-accent);
	}

	.us-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-normal);
	}

	.us-task.done .us-text,
	.us-task.cancelled .us-text {
		text-decoration: line-through;
		opacity: 0.5;
	}

	.us-assoc {
		flex-shrink: 0;
		font-size: 9px;
		padding: 0 5px;
		border-radius: 7px;
		background: var(--background-modifier-border);
		color: var(--text-muted);
	}

	.us-assoc.domain {
		background: var(--background-modifier-success);
	}

	.us-assoc.inherited {
		opacity: 0.6;
		font-style: italic;
	}

	.us-assoc.linked {
		cursor: pointer;
	}

	.us-assoc.linked:hover {
		text-decoration: underline;
	}
</style>
