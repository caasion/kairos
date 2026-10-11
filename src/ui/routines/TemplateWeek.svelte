<script lang="ts">
	// The template week beside the routines list: a simplified, read-only week of
	// what the routines add up to (decision 92). One column per weekday, Monday
	// first, with the block routines that repeat on it at their times; weekly
	// tasks with no timed block and monthly routines sit in a strip above.
	//
	// Nothing is edited here: the list is where routines change. Pointing at a
	// block lights every copy of it across the week, and its row and its tasks'
	// rows in the list; selecting one scrolls the list to it. Purely
	// presentational: the Routines view owns the hover state.

	import type { Block } from "../../types";
	import type { Resolver } from "../../index";
	import type { BlockRoutine, Routine } from "../../routines/routinesFile";
	import { ruleText, weekdayName } from "../../routines/rules";
	import { routineAssoc } from "../../routines/apply";
	import { tasksInBlock, templateWeek } from "../../routines/templateWeek";
	import { layoutBlocks, minutesToOffset, type TimelineGeometry } from "../timeline/layout";

	interface Props {
		routines: Routine[];
		resolve: Resolver;
		/** The hover key lit across the list and the week (routineLink), or null. */
		hovered: number | null;
		link: (r: Routine) => number;
		isPaused: (r: Routine) => boolean;
		onHover: (key: number | null) => void;
		/** Scroll the list to this routine. */
		onSelect: (r: Routine) => void;
	}

	let { routines, resolve, hovered, link, isPaused, onHover, onSelect }: Props = $props();

	const week = $derived(templateWeek(routines));
	const HOUR_HEIGHT = 24;
	const geo = $derived<TimelineGeometry>({
		startHour: week.startHour,
		endHour: week.endHour,
		hourHeight: HOUR_HEIGHT,
		topPad: 4,
	});
	const hours = $derived(
		Array.from({ length: week.endHour - week.startHour }, (_, i) => week.startHour + i),
	);
	const bodyHeight = $derived((week.endHour - week.startHour) * HOUR_HEIGHT + 8);

	// layoutBlocks lays out Blocks; a stand-in per routine carries its line.
	function asBlock(r: BlockRoutine): Block {
		return { source: { path: "", line: r.line }, title: r.title, time: r.time, tasks: [], scheduled: true };
	}
	function placements(blocks: BlockRoutine[]) {
		const byLine = new Map(blocks.map((b) => [b.line, b]));
		return layoutBlocks(blocks.map(asBlock), geo).map((p) => ({
			...p,
			routine: byLine.get(p.block.source.line)!,
		}));
	}

	function colorOf(r: Routine): string {
		const assoc = routineAssoc(r);
		return (assoc && resolve(assoc).color) || "var(--interactive-accent)";
	}

	function hhmm(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}

	function nameOf(r: Routine): string {
		return r.kind === "block" ? r.title : r.text;
	}
</script>

{#snippet chip(r: Routine, detail: string)}
	<button
		class="tw-chip"
		class:linked={hovered === link(r)}
		class:paused={isPaused(r)}
		style={`--tw-color: ${colorOf(r)};`}
		onpointerenter={() => onHover(link(r))}
		onpointerleave={() => onHover(null)}
		onclick={() => onSelect(r)}
	>
		<span class="tw-chip-text">{nameOf(r)}</span>
		<span class="tw-chip-detail">{detail}</span>
	</button>
{/snippet}

<div class="tw">
	<div class="tw-caption">Your week from these routines · add and edit them in the list</div>
	<div class="tw-head">
		<div class="tw-gutter"></div>
		{#each week.days as d (d.day)}
			<div class="tw-day-label">{weekdayName(d.day)}</div>
		{/each}
	</div>

	{#if week.untimed.length > 0 || week.monthly.length > 0}
		<div class="tw-strip">
			{#each week.untimed as r (r.line)}
				{@render chip(r, ruleText(r.rule))}
			{/each}
			{#each week.monthly as r (r.line)}
				{@render chip(r, ruleText(r.rule))}
			{/each}
		</div>
	{/if}

	<div class="tw-body" style={`height: ${bodyHeight}px;`}>
		<div class="tw-gutter">
			{#each hours as hour (hour)}
				<div class="tw-hour" style={`top: ${minutesToOffset(hour * 60, geo)}px;`}>
					{String(hour).padStart(2, "0")}
				</div>
			{/each}
		</div>
		{#each week.days as d (d.day)}
			<div class="tw-col">
				{#each hours as hour (hour)}
					<div class="tw-line" style={`top: ${minutesToOffset(hour * 60, geo)}px;`}></div>
				{/each}
				{#each placements(d.blocks) as p (p.routine.line)}
					{@const r = p.routine}
					{@const count = tasksInBlock(routines, r, d.day)}
					<button
						class="tw-block"
						class:linked={hovered === link(r)}
						class:paused={isPaused(r)}
						class:short={p.height < 30}
						style={`--tw-color: ${colorOf(r)}; top: ${p.top}px; height: ${p.height}px; left: calc(${(p.column / p.lanes) * 100}% + 1px); width: calc(${100 / p.lanes}% - 2px);`}
						aria-label={`${r.title}, ${hhmm(r.time.start)} to ${hhmm(r.time.end)}`}
						onpointerenter={() => onHover(link(r))}
						onpointerleave={() => onHover(null)}
						onclick={() => onSelect(r)}
					>
						<span class="tw-block-title">{r.title}</span>
						{#if p.height >= 30}
							<span class="tw-block-time">
								{hhmm(r.time.start)}–{hhmm(r.time.end)}{count > 0 ? ` · ${count} task${count === 1 ? "" : "s"}` : ""}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.tw {
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-size: 11px;
	}
	.tw-caption {
		padding: 2px 4px 4px 28px;
		font-size: 10px;
		color: var(--text-faint);
	}
	.tw-head {
		display: flex;
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--background-primary);
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.tw-gutter {
		position: relative;
		width: 28px;
		min-width: 28px;
	}
	.tw-day-label {
		flex: 1;
		min-width: 0;
		padding: 4px 4px 3px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.tw-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 6px 4px 6px 28px;
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.tw-chip {
		display: flex;
		align-items: baseline;
		gap: 5px;
		max-width: 100%;
		height: auto;
		padding: 1px 7px;
		border-radius: 9px;
		font-size: 11px;
		border: 1px solid color-mix(in srgb, var(--tw-color) 40%, transparent);
		background: transparent;
		box-shadow: none;
		cursor: pointer;
	}
	.tw-chip-text {
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tw-chip-detail {
		flex-shrink: 0;
		font-size: 10px;
		color: var(--text-faint);
	}

	.tw-body {
		display: flex;
		position: relative;
	}
	.tw-hour {
		position: absolute;
		right: 4px;
		transform: translateY(-50%);
		font-size: 9px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.tw-col {
		position: relative;
		flex: 1;
		min-width: 0;
		border-left: 1px solid var(--background-modifier-border);
	}
	.tw-line {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid color-mix(in srgb, var(--background-modifier-border) 60%, transparent);
	}

	.tw-block {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: flex-start;
		gap: 0;
		overflow: hidden;
		padding: 2px 4px 2px 5px;
		border-radius: 4px;
		border: none;
		border-left: 2px solid var(--tw-color);
		background: color-mix(in srgb, var(--tw-color) 14%, var(--background-primary));
		box-shadow: none;
		cursor: pointer;
		text-align: left;
	}
	.tw-block.short {
		justify-content: center;
		padding-top: 0;
		padding-bottom: 0;
	}
	.tw-block-title {
		max-width: 100%;
		font-size: 11px;
		font-weight: 600;
		line-height: 1.25;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tw-block-time {
		max-width: 100%;
		font-size: 10px;
		line-height: 1.25;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Every copy of the routine under the pointer lights together. */
	.tw-block.linked,
	.tw-chip.linked {
		background: color-mix(in srgb, var(--tw-color) 30%, var(--background-primary));
		outline: 1px solid var(--tw-color);
		z-index: 1;
	}
	.tw-block.paused,
	.tw-chip.paused {
		opacity: 0.45;
	}
</style>
