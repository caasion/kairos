<script lang="ts">
	// The Routines view's Week tab: the days your weekly routines produce,
	// Monday to Sunday, read-only (decision 119). Drawn with the Week view's own
	// pieces, so it reads like the Week view: the DateCard header (the weekday
	// over the hours its blocks take), the hour gutter and lines, and
	// TimelineBlock in its read-only mode, laid out by `layoutBlocks`, so
	// overlapping blocks sit side by side. A day with overlaps gets a warning
	// badge listing them. Free time is the empty space. Selecting a block shows
	// it in the list, where routines are edited.

	import type { Readable } from "svelte/store";
	import type { Block, ResolvedTask } from "../../types";
	import type { KairosSettings } from "../../settings";
	import type { Resolver } from "../../index";
	import type { BlockRoutine, Routine, TaskRoutine } from "../../routines/routinesFile";
	import { formatDuration, routinesWeek } from "../../routines/routinesWeek";
	import { weekdayName } from "../../routines/rules";
	import { formatTimeRange } from "../../parser";
	import { geometryFromSettings, layoutBlocks, type TimelineGeometry } from "../timeline/layout";
	import DateCard from "../components/DateCard.svelte";
	import HourGutter from "../components/HourGutter.svelte";
	import HourLines from "../components/HourLines.svelte";
	import HeaderBadge from "../timeline/HeaderBadge.svelte";
	import TimelineBlock from "../timeline/TimelineBlock.svelte";
	import { icon } from "../actions/icon";

	interface Props {
		routines: Routine[];
		resolve: Resolver;
		settings$: Readable<KairosSettings>;
		isPaused: (r: Routine) => boolean;
		/** Show this block routine in the list. */
		onSelect: (r: BlockRoutine) => void;
		/** Where the routines live, for the stand-in blocks' source. */
		path: string;
	}

	let { routines, resolve, settings$, isPaused, onSelect, path }: Props = $props();

	const week = $derived(routinesWeek(routines));

	// The Week view's geometry (hour height, hours shown), widened to fit any
	// routine outside those hours.
	const geo = $derived.by<TimelineGeometry>(() => {
		const base = geometryFromSettings($settings$);
		const span = week.span;
		if (!span) return base;
		return {
			...base,
			startHour: Math.min(base.startHour, span.startHour),
			endHour: Math.max(base.endHour, span.endHour),
		};
	});

	/** A block routine as the timeline draws a block. */
	function asBlock(r: BlockRoutine): Block {
		return {
			source: { path, line: r.line },
			title: r.title,
			...(r.assoc ? { assoc: r.assoc } : {}),
			tasks: [],
			scheduled: true,
			time: r.time,
		};
	}

	/** Its tasks as the timeline draws them: templates, inheriting the block's association. */
	function asTasks(tasks: TaskRoutine[], block: Block): ResolvedTask[] {
		return tasks.map((t) => {
			const owner = t.assoc ?? t.inherited ?? block.assoc;
			return {
				source: { path, line: t.line },
				text: t.text,
				status: " ",
				...(t.assoc ? { assoc: t.assoc } : {}),
				date: "",
				block,
				...(owner ? { owner } : {}),
				scheduled: true,
			};
		});
	}

	/** A day's blocks placed in lanes, each with its routine and tasks. */
	function placed(day: (typeof week.days)[number]) {
		const byLine = new Map(day.blocks.map((r) => [r.line, r]));
		return layoutBlocks(day.blocks.map(asBlock), geo).map((p) => {
			const routine = byLine.get(p.block.source.line)!;
			return { ...p, routine, tasks: asTasks(day.tasks.get(routine) ?? [], p.block) };
		});
	}

	// A read-only block never calls its write-backs.
	const noop = () => {};
	const INERT = {
		onNavigate: noop,
		onGestureStart: noop,
		onDelete: noop,
		onSetTaskStatus: noop,
		onSetTaskText: noop,
		onDeleteTask: noop,
		onEditTaskAssoc: noop,
		onNestTask: noop,
		onMoveTaskToBacklog: noop,
		onTaskGrab: noop,
		onSetBlockTitle: noop,
		onSetBlockTime: noop,
		onAddTask: noop,
		onAddNote: noop,
		onSetNoteText: noop,
		onEditAssoc: noop,
	};

	const extras = $derived(
		[
			week.untimed > 0 ? `${week.untimed} task${week.untimed === 1 ? "" : "s"} without a block` : "",
			week.monthly > 0 ? `${week.monthly} monthly routine${week.monthly === 1 ? "" : "s"}` : "",
		].filter(Boolean),
	);
</script>

{#snippet overlapIcon()}
	<span class="rw-icon" use:icon={"alert-triangle"}></span>
{/snippet}

<div class="rw">
	{#if extras.length > 0}
		<div class="rw-extras">Also {extras.join(" · ")}, not shown here.</div>
	{/if}

	<div class="rw-heads">
		<HourGutter {geo} corner />
		{#each week.days as d (d.day)}
			<DateCard label={weekdayName(d.day)} value={d.minutes > 0 ? formatDuration(d.minutes) : "Free"}>
				{#snippet badges()}
					{#if d.overlaps.size > 0}
						<HeaderBadge title="Overlaps" dateLabel={weekdayName(d.day)} count={d.overlaps.size} icon={overlapIcon} tone="warn">
							{#each d.blocks.filter((b) => d.overlaps.has(b)) as b (b.line)}
								<div class="kairos-meta-row rw-overlap-row">
									<span class="kairos-meta">{formatTimeRange(b.time)}</span>
									<span class="rw-overlap-title">{b.title}</span>
								</div>
							{/each}
						</HeaderBadge>
					{/if}
				{/snippet}
			</DateCard>
		{/each}
	</div>

	<div class="rw-body">
		<HourGutter {geo} />
		<div class="rw-columns">
			<HourLines {geo} />
			{#each week.days as d (d.day)}
				<div class="rw-col">
					{#each placed(d) as p (p.routine.line)}
						<TimelineBlock
							block={p.block}
							tasks={p.tasks}
							top={p.top}
							height={p.height}
							column={p.column}
							lanes={p.lanes}
							{resolve}
							readonly
							muted={isPaused(p.routine)}
							onSelect={() => onSelect(p.routine)}
							{...INERT}
						/>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.rw-extras {
		font-size: var(--kairos-text-label);
		color: var(--text-faint);
		padding: 0 var(--size-4-3) var(--size-4-2);
	}
	/* Laid out like the Week view: a header row of cards over the gutter and
	   the day columns, both inset 10px. The header stays in view as the hours
	   scroll under it. */
	.rw-heads {
		display: flex;
		padding: 0 10px;
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--background-primary);
	}
	.rw-body {
		display: flex;
		padding: 0 10px var(--size-4-4);
		min-width: 0;
	}
	.rw-columns {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
	}
	.rw-col {
		flex: 1;
		min-width: 0;
		position: relative;
		border-left: 1px solid var(--background-modifier-border);
	}
	.rw-icon {
		display: flex;
		--icon-size: var(--icon-xs);
	}
	.rw-overlap-row {
		padding: var(--size-2-1) var(--size-4-1);
	}
	.rw-overlap-title {
		font-size: var(--kairos-text-body);
		color: var(--text-normal);
	}
</style>
