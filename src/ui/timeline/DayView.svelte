<script lang="ts">
	import type { App, TFile } from "obsidian";
	import { onMount } from "svelte";
	import { parseSchedule } from "../../parser";
	import { resolveBlocks } from "../../resolver";
	import type { KairosSettings } from "../../settings";
	import type { Block, ISODate, ResolvedTask } from "../../types";
	import TimelineBlock from "./TimelineBlock.svelte";
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

	const tasksByBlock = $derived.by(() => {
		const map = new Map<Block, ResolvedTask[]>();
		for (const block of blocks) map.set(block, []);
		for (const task of resolved) map.get(task.block)?.push(task);
		return map;
	});

	const placements = $derived(layoutBlocks(blocks, geo));

	// Untimed blocks (the Unscheduled inbox and any other untimed item) render as
	// a plain list below the timeline, since they have no position on it.
	const unscheduled = $derived(blocks.filter((b) => !b.scheduled));

	const needleTop = $derived(minutesToOffset(nowMinutes, geo));
	const needleVisible = $derived(
		nowMinutes >= geo.startHour * 60 && nowMinutes <= geo.endHour * 60,
	);

	onMount(() => {
		void refresh();

		const onOpen = app.workspace.on("file-open", () => void refresh());
		const onModify = app.vault.on("modify", (f) => {
			if (f.path === notePath) void refresh();
		});
		const tick = window.setInterval(() => {
			nowMinutes = currentMinutes();
		}, 60_000);

		return () => {
			app.workspace.offref(onOpen);
			app.vault.offref(onModify);
			window.clearInterval(tick);
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="day-view" onclick={handleClickOutside}>
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

				<!-- Positioned blocks + grid lines -->
				<div class="day-canvas">
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
							tasks={tasksByBlock.get(p.block) ?? []}
							top={p.top}
							height={p.height}
							column={p.column}
							lanes={p.lanes}
						/>
					{/each}
				</div>
			</div>

			{#if unscheduled.length > 0}
				<div class="day-unscheduled">
					{#each unscheduled as block (block.source.line)}
						{@const tasks = tasksByBlock.get(block) ?? []}
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
