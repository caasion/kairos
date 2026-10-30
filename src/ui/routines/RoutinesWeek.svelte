<script lang="ts">
	// The Routines view's Week tab: the days your weekly routines produce,
	// Monday to Sunday, read-only (decision 119). Each column header says how
	// much of the day the blocks take and whether any collide; colliding blocks
	// sit side by side, laid out by the timeline's own `layoutBlocks`, with an
	// orange edge. Free time is the empty space. Selecting a block shows it in
	// the list, where routines are edited.

	import type { Block } from "../../types";
	import type { Resolver } from "../../index";
	import type { BlockRoutine, Routine } from "../../routines/routinesFile";
	import { formatDuration, routinesWeek } from "../../routines/routinesWeek";
	import { weekdayName } from "../../routines/rules";
	import { formatTimeRange } from "../../parser";
	import { gridHeight, layoutBlocks, minutesToOffset, visibleHours, type TimelineGeometry } from "../timeline/layout";
	import { peek } from "../actions/peek";

	interface Props {
		routines: Routine[];
		resolve: Resolver;
		isPaused: (r: Routine) => boolean;
		/** Show this block routine in the list. */
		onSelect: (r: BlockRoutine) => void;
	}

	let { routines, resolve, isPaused, onSelect }: Props = $props();

	const week = $derived(routinesWeek(routines));
	const geo = $derived<TimelineGeometry>({
		startHour: week.startHour,
		endHour: week.endHour,
		hourHeight: 40,
		topPad: 0,
	});

	/** A day's blocks placed in lanes, each paired back with its routine. */
	function placed(blocks: BlockRoutine[]) {
		const byLine = new Map(blocks.map((b) => [b.line, b]));
		const asBlocks: Block[] = blocks.map((b) => ({
			source: { path: "", line: b.line },
			title: b.title,
			tasks: [],
			scheduled: true,
			time: b.time,
		}));
		return layoutBlocks(asBlocks, geo).map((p) => ({ ...p, routine: byLine.get(p.block.source.line)! }));
	}

	const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

	const extras = $derived(
		[
			week.untimed > 0 ? `${week.untimed} task${week.untimed === 1 ? "" : "s"} without a block` : "",
			week.monthly > 0 ? `${week.monthly} monthly routine${week.monthly === 1 ? "" : "s"}` : "",
		].filter(Boolean),
	);
</script>

<div class="rw">
	{#if extras.length > 0}
		<div class="rw-extras">Also {extras.join(" · ")}, not shown here.</div>
	{/if}
	<div class="rw-grid">
		<div class="rw-corner"></div>
		{#each week.days as d (d.day)}
			<div class="rw-head">
				<span class="rw-day">{weekdayName(d.day)}</span>
				<span class="rw-hours">{d.minutes > 0 ? formatDuration(d.minutes) : "Free"}</span>
				{#if d.overlaps.size > 0}<span class="rw-overlap-tag">Overlap</span>{/if}
			</div>
		{/each}

		<div class="rw-gutter" style:height="{gridHeight(geo)}px">
			{#each visibleHours(geo) as h (h)}
				<span class="rw-hour" style:top="{minutesToOffset(h * 60, geo)}px">{hourLabel(h)}</span>
			{/each}
		</div>
		{#each week.days as d (d.day)}
			<div class="rw-col" style:height="{gridHeight(geo)}px">
				{#each visibleHours(geo) as h (h)}
					<div class="rw-line" style:top="{minutesToOffset(h * 60, geo)}px"></div>
				{/each}
				{#each placed(d.blocks) as p (p.routine.line)}
					{@const r = p.routine}
					{@const color = r.assoc ? resolve(r.assoc).color : undefined}
					{@const tasks = d.taskCount.get(r) ?? 0}
					<div
						class="rw-block"
						role="button"
						tabindex="0"
						class:is-overlap={d.overlaps.has(r)}
						class:is-paused={isPaused(r)}
						style:top="{p.top}px"
						style:height="{Math.max(p.height, 14)}px"
						style:left="calc({(p.column / p.lanes) * 100}% + 1px)"
						style:width="calc({100 / p.lanes}% - 2px)"
						style:--rw-color={color}
						onclick={() => onSelect(r)}
						onkeydown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onSelect(r);
							}
						}}
					>
						<span class="rw-title" use:peek>{r.title}</span>
						{#if p.height >= 28}
							<span class="rw-meta">{formatTimeRange(r.time)}{tasks > 0 ? ` · ${tasks} task${tasks === 1 ? "" : "s"}` : ""}</span>
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.rw {
		padding: 0 var(--size-4-3) var(--size-4-4);
	}
	.rw-extras {
		font-size: var(--kairos-text-label);
		color: var(--text-faint);
		padding: 0 var(--size-4-1) var(--size-4-2);
	}
	.rw-grid {
		display: grid;
		grid-template-columns: auto repeat(7, minmax(0, 1fr));
		column-gap: var(--size-2-1);
	}
	.rw-head {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--size-2-1);
		padding-bottom: var(--size-4-2);
		position: sticky;
		top: 0;
		background: var(--background-primary);
		z-index: 2;
	}
	.rw-corner {
		position: sticky;
		top: 0;
		background: var(--background-primary);
		z-index: 2;
	}
	.rw-day {
		font-size: var(--kairos-text-label);
		font-weight: var(--font-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
	}
	.rw-hours {
		font-size: var(--kairos-text-body);
		color: var(--text-normal);
		font-variant-numeric: tabular-nums;
	}
	.rw-overlap-tag {
		font-size: var(--kairos-text-meta);
		color: var(--color-orange);
	}
	.rw-gutter {
		position: relative;
		width: 3em;
	}
	.rw-hour {
		position: absolute;
		right: var(--size-4-1);
		transform: translateY(-50%);
		font-size: var(--kairos-text-meta);
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.rw-hour:first-child {
		transform: none;
	}
	.rw-col {
		position: relative;
		background: var(--background-secondary);
		border-radius: var(--kairos-radius-s);
	}
	.rw-line {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--background-modifier-border);
	}
	.rw-line:first-child {
		display: none;
	}
	.rw-block {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: flex-start;
		padding: var(--size-2-1) var(--size-2-2);
		box-sizing: border-box;
		overflow: hidden;
		cursor: pointer;
		border: 1px solid var(--background-modifier-border);
		border-left: var(--kairos-accent-width) solid var(--rw-color, var(--interactive-accent));
		border-radius: var(--kairos-radius-s);
		background: color-mix(in srgb, var(--rw-color, var(--interactive-accent)) 10%, var(--background-primary));
		color: var(--text-normal);
	}
	.rw-block:hover {
		background: color-mix(in srgb, var(--rw-color, var(--interactive-accent)) 20%, var(--background-primary));
	}
	.rw-block.is-overlap {
		border-color: var(--color-orange);
		border-left-color: var(--color-orange);
	}
	.rw-block.is-paused {
		opacity: 0.5;
	}
	.rw-title {
		max-width: 100%;
		font-size: var(--kairos-text-label);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rw-meta {
		max-width: 100%;
		font-size: var(--kairos-text-meta);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
