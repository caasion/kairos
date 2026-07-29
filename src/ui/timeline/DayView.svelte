<script lang="ts">
	import type { App, TFile } from "obsidian";
	import { onMount } from "svelte";
	import { parseSchedule } from "../../parser";
	import { resolveBlocks } from "../../resolver";
	import type { KairosSettings } from "../../settings";
	import type { Block, ISODate, ResolvedTask, TimeRange } from "../../types";
	import {
		deleteBlocks,
		makeBlock,
		retimeBlocks,
		writeSchedule,
	} from "../../writer";
	import TimelineBlock from "./TimelineBlock.svelte";
	import {
		type Gesture,
		beginBlockGesture,
		beginCreateGesture,
		updateGesture,
	} from "./interactions";
	import {
		geometryFromSettings,
		gridHeight,
		layoutBlocks,
		minutesToOffset,
		visibleHours,
	} from "./layout";

	interface Props {
		app: App;
		settings: KairosSettings;
		saveSettings: () => void;
	}

	let { app, settings, saveSettings }: Props = $props();

	// Geometry follows the persisted hour-range / zoom settings, live.
	const geo = $derived(geometryFromSettings(settings));
	const hours = $derived(visibleHours(geo));
	const bodyHeight = $derived(gridHeight(geo));

	// Inline hour-range control (Holos-style popover in the header).
	let showControls = $state(false);
	let controlsRef = $state<HTMLDivElement>();

	function setStartHour(value: number) {
		const v = Math.max(0, Math.min(23, Math.floor(value)));
		settings.timelineStartHour = v;
		if (settings.timelineEndHour <= v) settings.timelineEndHour = v + 1;
		saveSettings();
	}

	function setEndHour(value: number) {
		const v = Math.max(1, Math.min(24, Math.floor(value)));
		settings.timelineEndHour = v;
		if (settings.timelineStartHour >= v) settings.timelineStartHour = v - 1;
		saveSettings();
	}

	function setHourHeight(value: number) {
		settings.timelineHourHeight = Math.max(20, Math.min(240, Math.floor(value)));
		saveSettings();
	}

	function handleClickOutside(event: MouseEvent) {
		if (
			showControls &&
			controlsRef &&
			!controlsRef.contains(event.target as Node)
		) {
			showControls = false;
		}
	}

	let blocks = $state<Block[]>([]);
	let resolved = $state<ResolvedTask[]>([]);
	let date = $state<ISODate>("");
	let notePath = $state<string | null>(null);

	// A live-updating "now" offset, so the needle tracks real time.
	let nowMinutes = $state(currentMinutes());
	function currentMinutes(): number {
		const d = new Date();
		return d.getHours() * 60 + d.getMinutes();
	}

	function dateOf(file: TFile): ISODate {
		const m = /(\d{4}-\d{2}-\d{2})/.exec(file.basename);
		return m?.[1] ?? file.basename;
	}

	async function refresh() {
		const file = app.workspace.getActiveFile();
		if (!file) {
			blocks = [];
			resolved = [];
			notePath = null;
			return;
		}
		const markdown = await app.vault.read(file);
		notePath = file.path;
		date = dateOf(file);
		blocks = parseSchedule(markdown, file.path);
		resolved = resolveBlocks(blocks, date);
	}

	// Tasks keyed by their block's source line, so lookups survive the preview
	// pass (which clones blocks into new objects but keeps their source).
	const tasksBySource = $derived.by(() => {
		const map = new Map<number, ResolvedTask[]>();
		for (const block of blocks) map.set(block.source.line, []);
		for (const task of resolved) map.get(task.block.source.line)?.push(task);
		return map;
	});

	// ── Interaction state ──────────────────────────────────────────
	// A live gesture (move/resize/create) previews in local state and only
	// writes on drop, so the file isn't churned mid-drag (and the timeline
	// doesn't flicker from re-parsing under the pointer).

	let selection = $state<Set<Block>>(new Set());
	let gesture = $state<Gesture | null>(null);
	// Previewed ranges for blocks under an active move/resize, keyed by block.
	let preview = $state<Map<Block, TimeRange>>(new Map());
	// A create gesture's sketched range, positioned but not yet a real block.
	let draft = $state<TimeRange | null>(null);
	let canvasEl = $state<HTMLDivElement>();

	// Blocks with the live preview applied, so layout math sees the dragged
	// position. Untimed blocks pass through untouched.
	const displayBlocks = $derived.by(() => {
		if (preview.size === 0) return blocks;
		return blocks.map((b) => {
			const time = preview.get(b);
			return time ? { ...b, time } : b;
		});
	});

	const placements = $derived(layoutBlocks(displayBlocks, geo));

	// Map a display block back to its selection membership. Preview produces new
	// objects, so we compare by source line (stable within a render).
	const selectedLines = $derived(
		new Set([...selection].map((b) => b.source.line)),
	);
	function isSelected(b: Block): boolean {
		return selectedLines.has(b.source.line);
	}

	// The draft rectangle, if a create gesture has covered enough distance.
	const draftRect = $derived(
		draft
			? {
					top: minutesToOffset(draft.start, geo),
					height: minutesToOffset(draft.end, geo) - minutesToOffset(draft.start, geo),
				}
			: null,
	);

	// Untimed blocks (the Unscheduled inbox and any other untimed item) render as
	// a plain list below the timeline, since they have no position on it.
	const unscheduled = $derived(blocks.filter((b) => !b.scheduled));

	const needleTop = $derived(minutesToOffset(nowMinutes, geo));
	const needleVisible = $derived(
		nowMinutes >= geo.startHour * 60 && nowMinutes <= geo.endHour * 60,
	);

	// ── Gesture lifecycle ──────────────────────────────────────────

	// Pointer offset (px) from the top of the canvas body for an event.
	function canvasOffset(event: PointerEvent): number {
		const rect = canvasEl?.getBoundingClientRect();
		return event.clientY - (rect?.top ?? 0);
	}

	// A gesture only "commits" once the pointer has moved past this many pixels,
	// so a plain click selects (or does nothing) instead of nudging a block by a
	// stray pixel.
	const DRAG_THRESHOLD_PX = 3;
	let gestureOriginY = $state(0);
	let gestureMoved = $state(false);

	// Started from a block (move or resize). Selection rules follow the platform
	// convention: shift/ctrl toggles, a plain press on an unselected block makes
	// it the sole selection.
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

		// Resize always acts on the single grabbed block; move acts on the whole
		// selection so a group can be dragged together.
		const targets =
			mode === "move" && selection.size > 0 ? [...selection] : [block];

		gesture = beginBlockGesture(mode, targets, canvasOffset(event), geo);
		gestureOriginY = event.clientY;
		gestureMoved = false;
		capturePointer(event);
	}
 
	// Pressed on empty canvas: begin a create gesture and clear any selection.
	function onCanvasPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		// Ignore presses that landed on a block (those bubble here after their own
		// handler ran); a block press sets `gesture` already.
		if (gesture) return;
		selection = new Set();
		gesture = beginCreateGesture(canvasOffset(event), geo);
		gestureOriginY = event.clientY;
		gestureMoved = false;
		capturePointer(event);
	}

	function capturePointer(event: PointerEvent) {
		(event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!gesture) return;
		// Suppress sub-threshold jitter so a click isn't read as a drag.
		if (
			!gestureMoved &&
			Math.abs(event.clientY - gestureOriginY) < DRAG_THRESHOLD_PX
		) {
			return;
		}
		gestureMoved = true;
		const p = updateGesture(gesture, canvasOffset(event), notePath ?? "");
		preview = p.ranges;
		draft = p.draft ?? null;
	}

	async function onPointerUp() {
		if (!gesture) return;
		const g = gesture;
		const committedPreview = preview;
		const committedDraft = draft;
		const moved = gestureMoved;

		// Reset interaction state before persisting; the reparse from the write
		// will rebuild block identities anyway.
		gesture = null;
		preview = new Map();
		draft = null;

		if (!moved) return; // a click, not a drag — selection already handled

		if (g.mode === "create") {
			if (committedDraft) await commitCreate(committedDraft);
			return;
		}
		if (committedPreview.size > 0) await commitRetime(committedPreview);
	}

	async function commitRetime(ranges: Map<Block, TimeRange>) {
		const file = app.workspace.getActiveFile();
		if (!file) return;
		const next = retimeBlocks(blocks, ranges);
		await writeSchedule(app.vault, file, next);
		selection = new Set();
	}

	async function commitCreate(range: TimeRange) {
		const file = app.workspace.getActiveFile();
		if (!file) return;
		const block = makeBlock(range, file.path);
		await writeSchedule(app.vault, file, [...blocks, block]);
	}

	async function deleteSelected() {
		if (selection.size === 0) return;
		const file = app.workspace.getActiveFile();
		if (!file) return;
		const next = deleteBlocks(blocks, selection);
		selection = new Set();
		await writeSchedule(app.vault, file, next);
	}

	function onKeyDown(event: KeyboardEvent) {
		// X (or Delete/Backspace) removes the current selection.
		const key = event.key.toLowerCase();
		if (key === "x" || key === "delete" || key === "backspace") {
			if (selection.size === 0) return;
			event.preventDefault();
			void deleteSelected();
		} else if (key === "escape") {
			selection = new Set();
		}
	}

	onMount(() => {
		void refresh();

		const onOpen = app.workspace.on("file-open", () => void refresh());
		const onModify = app.vault.on("modify", (f) => {
			if (f.path === notePath) void refresh();
		});
		const tick = window.setInterval(() => {
			nowMinutes = currentMinutes();
		}, 60_000);

		// Window-level so a drag keeps tracking even when the pointer leaves a
		// block or the canvas entirely.
		const move = (e: PointerEvent) => onPointerMove(e);
		const up = () => void onPointerUp();
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);

		return () => {
			app.workspace.offref(onOpen);
			app.vault.offref(onModify);
			window.clearInterval(tick);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- tabindex lets the view receive the X / Delete / Escape keys for the
     current block selection. -->
<div
	class="day-view"
	tabindex="-1"
	onclick={handleClickOutside}
	onkeydown={onKeyDown}
>
	<div class="day-header">
		<span class="day-date">{date || "—"}</span>
		<span class="day-header-spacer"></span>
		<span class="day-range-label">
			{String(geo.startHour).padStart(2, "0")}:00–{String(geo.endHour).padStart(2, "0")}:00
		</span>
		<div class="controls-wrap" bind:this={controlsRef}>
			<button
				class="icon-btn"
				onclick={(e) => {
					e.stopPropagation();
					showControls = !showControls;
				}}
				aria-label="Timeline hours"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
			</button>

			{#if showControls}
				<div class="controls-popup">
					<label class="controls-field">
						<span class="controls-label">Start hour</span>
						<input
							type="number"
							class="controls-input"
							min="0"
							max="23"
							value={geo.startHour}
							oninput={(e) => setStartHour(+e.currentTarget.value)}
						/>
					</label>
					<label class="controls-field">
						<span class="controls-label">End hour</span>
						<input
							type="number"
							class="controls-input"
							min="1"
							max="24"
							value={geo.endHour}
							oninput={(e) => setEndHour(+e.currentTarget.value)}
						/>
					</label>
					<label class="controls-field">
						<span class="controls-label">Hour height</span>
						<input
							type="number"
							class="controls-input"
							min="20"
							max="240"
							step="5"
							value={geo.hourHeight}
							oninput={(e) => setHourHeight(+e.currentTarget.value)}
						/>
					</label>
				</div>
			{/if}
		</div>
	</div>

	{#if notePath === null}
		<p class="day-empty">Open a daily note to see its schedule.</p>
	{:else}
		<div class="day-scroll">
			<div class="day-body" style={`height: ${bodyHeight}px;`}>
				<!-- Hour gutter -->
				<div class="day-gutter">
					{#each hours as hour (hour)}
						<div
							class="day-hour-label"
							style={`top: ${minutesToOffset(hour * 60, geo)}px;`}
						>
							{String(hour).padStart(2, "0")}:00
						</div>
					{/each}
				</div>

				<!-- Positioned blocks + grid lines. Pressing empty canvas starts a
				     create-drag; presses on a block are handled by the block. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="day-canvas"
					class:creating={gesture?.mode === "create"}
					bind:this={canvasEl}
					onpointerdown={onCanvasPointerDown}
				>
					{#each hours as hour (hour)}
						<div
							class="day-hour-line"
							style={`top: ${minutesToOffset(hour * 60, geo)}px;`}
						></div>
					{/each}

					{#if needleVisible}
						<div class="day-needle" style={`top: ${needleTop}px;`}></div>
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
							onGestureStart={onBlockGestureStart}
							onDelete={onDelete}
						/>
					{/each}

					{#if draftRect}
						<div
							class="day-draft"
							style={`top: ${draftRect.top}px; height: ${draftRect.height}px;`}
						></div>
					{/if}
				</div>
			</div>

			{#if unscheduled.length > 0}
				<div class="day-unscheduled">
					{#each unscheduled as block (block.source.line)}
						{@const tasks = tasksBySource.get(block.source.line) ?? []}
						<div class="us-block">
							<div class="us-title">{block.title}</div>
							{#each tasks.filter((t) => !t.colocated) as task (task.source.line)}
								<div
									class="us-task"
									class:done={task.status === "x"}
									class:cancelled={task.status === "-"}
								>
									<span class="us-dot" class:half={task.status === "/"}></span>
									<span class="us-text">{task.text}</span>
									{#if task.owner}
										<span
											class="us-assoc"
											class:domain={task.owner.kind === "domain"}
											class:inherited={task.assoc === undefined}
										>
											{task.owner.id}
										</span>
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.day-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.day-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px 6px;
		flex-shrink: 0;
	}

	.day-date {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.day-header-spacer {
		flex: 1;
	}

	.day-range-label {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/* ── Inline controls (Holos-style icon button + popover) ── */
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

	.day-empty {
		color: var(--text-muted);
		font-size: 13px;
		padding: 8px 10px;
	}

	.day-scroll {
		flex: 1;
		overflow-y: auto;
	}

	.day-body {
		position: relative;
		display: flex;
	}

	/* ── Hour gutter ── */
	.day-gutter {
		width: 46px;
		min-width: 46px;
		position: relative;
		border-right: 1px solid var(--background-modifier-border);
	}

	.day-hour-label {
		position: absolute;
		right: 6px;
		transform: translateY(-0.5em);
		font-size: 10px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	/* ── Canvas ── */
	.day-canvas {
		position: relative;
		flex: 1;
		min-width: 0;
		cursor: crosshair;
	}

	/* Sketched rectangle shown while dragging out a new block. */
	.day-draft {
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

	.day-hour-line {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--background-modifier-border);
		opacity: 0.5;
	}

	.day-needle {
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--color-red, var(--interactive-accent));
		z-index: 3;
		pointer-events: none;
	}

	.day-needle::before {
		content: "";
		position: absolute;
		left: -3px;
		top: -3px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-red, var(--interactive-accent));
	}

	/* ── Unscheduled ── */
	.day-unscheduled {
		padding: 10px;
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
</style>
