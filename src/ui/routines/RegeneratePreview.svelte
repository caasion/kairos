<script lang="ts">
	// The body of "Regenerate routines": the day as it would be, drawn like the
	// Day view, beside the list of changes. The timeline shows the day with the
	// checked changes applied (`applyRegenerate`), so checking or unchecking a
	// change shows its effect at once: what a checked change adds or alters is
	// outlined, and the rest of the day is greyed. The list is sorted by time,
	// one change per row with a checkbox; tasks with no block come last.
	// Read-only throughout, with TimelineBlock in its read-only mode.

	import type { Association, Block, ResolvedTask } from "../../types";
	import type { Resolver } from "../../index";
	import type { KairosSettings } from "../../settings";
	import { formatTimeRange } from "../../parser";
	import { applyRegenerate, type RegenChange } from "../../routines/regenerate";
	import { geometryFromSettings, gridHeight, layoutBlocks, type TimelineGeometry } from "../timeline/layout";
	import HourGutter from "../components/HourGutter.svelte";
	import HourLines from "../components/HourLines.svelte";
	import TimelineBlock from "../timeline/TimelineBlock.svelte";

	interface Props {
		blocks: Block[];
		changes: RegenChange[];
		path: string;
		resolve: Resolver;
		settings: KairosSettings;
		initialPicked: Set<string>;
		onChange: (picked: Set<string>) => void;
	}

	let { blocks, changes, path, resolve, settings, initialPicked, onChange }: Props = $props();
	// svelte-ignore state_referenced_locally
	let picked = $state(new Set(initialPicked));

	function toggle(key: string, on: boolean) {
		const next = new Set(picked);
		if (on) next.add(key);
		else next.delete(key);
		picked = next;
		onChange(new Set(next));
	}

	const before = $derived(new Set(blocks));
	const after = $derived(applyRegenerate(blocks, changes.filter((c) => picked.has(c.key)), path));

	// Hours: wide enough for the day with every change applied, so the
	// timeline doesn't jump as changes are checked; short hours so a whole
	// day fits without much scrolling.
	const geo = $derived.by<TimelineGeometry>(() => {
		const base = geometryFromSettings(settings);
		const timed = applyRegenerate(blocks, changes, path).flatMap((b) => (b.time ? [b.time] : []));
		if (timed.length === 0) return { ...base, hourHeight: 32 };
		const start = Math.min(...timed.map((t) => t.start));
		const end = Math.max(...timed.map((t) => t.end));
		return {
			...base,
			startHour: Math.min(base.startHour, Math.floor(start / 60)),
			endHour: Math.max(base.endHour, Math.min(24, Math.ceil(end / 60))),
			hourHeight: 32,
		};
	});

	const placed = $derived(layoutBlocks(after, geo));

	function tasksOf(block: Block): ResolvedTask[] {
		return block.tasks.map((t) => {
			const owner = t.assoc ?? block.assoc;
			return { ...t, date: "", block, ...(owner ? { owner } : {}), scheduled: true };
		});
	}

	const name = (a: Association | undefined) => (a ? resolve(a).displayName : "none");

	/** When a change happens in the day, for sorting; tasks with no block last. */
	function when(c: RegenChange): number {
		switch (c.kind) {
			case "assoc":
			case "time":
				return c.routine.time.start;
			case "task-assoc":
				return c.block.time?.start ?? Infinity;
			case "task":
				return blocks.find((b) => b.title === c.home && b.time)?.time?.start ?? Infinity;
			case "missing":
				if (c.routine.kind === "block") return c.routine.time.start;
				// A task whose home block is also new sits with that block.
				for (const o of changes) {
					if (o.kind === "missing" && o.routine.kind === "block" && o.routine.title === c.routine.home) {
						return o.routine.time.start;
					}
				}
				return Infinity;
		}
	}

	/** A change as a row: its time, what it's about, and what applying it does. */
	function row(c: RegenChange): { time: string; name: string; what: string } {
		switch (c.kind) {
			case "assoc":
				return { time: formatTimeRange(c.routine.time), name: c.routine.title, what: `${name(c.from)} → ${name(c.to)}` };
			case "task-assoc":
				return { time: "", name: c.routine.text, what: `In ${c.block.title} · ${name(c.from)} → ${name(c.to)}` };
			case "time":
				return { time: formatTimeRange(c.to), name: c.routine.title, what: `Move from ${formatTimeRange(c.from)}` };
			case "task":
				return { time: "", name: c.routine.text, what: `Add task to ${c.home}` };
			case "missing": {
				const r = c.routine;
				if (r.kind === "block") {
					return { time: formatTimeRange(r.time), name: r.title, what: r.assoc ? `New · ${name(r.assoc)}` : "New" };
				}
				return { time: "", name: r.text, what: r.home ? `Add task to ${r.home}, or Unscheduled` : "Add task to Unscheduled" };
			}
		}
	}

	const rows = $derived(
		changes
			.map((c, i) => ({ c, i, at: when(c), ...row(c) }))
			.sort((a, b) => a.at - b.at || a.i - b.i),
	);

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
</script>

<div class="rg">
	<div class="rg-day">
		<div class="rg-body">
			<HourGutter {geo} />
			<div class="rg-col" style:height="{gridHeight(geo)}px">
				<HourLines {geo} />
				{#each placed as p (p.block.source.line)}
					<TimelineBlock
						block={p.block}
						tasks={tasksOf(p.block)}
						top={p.top}
						height={p.height}
						column={p.column}
						lanes={p.lanes}
						{resolve}
						readonly
						selected={!before.has(p.block)}
						muted={before.has(p.block)}
						{...INERT}
					/>
				{/each}
			</div>
		</div>
	</div>

	<ul class="rg-list">
		{#each rows as r (r.c.key)}
			<li>
				<label class="rg-row" class:is-off={!picked.has(r.c.key)}>
					<input
						type="checkbox"
						checked={picked.has(r.c.key)}
						onchange={(e) => toggle(r.c.key, e.currentTarget.checked)}
					/>
					<span class="rg-text">
						<span class="rg-line">
							{#if r.time}<span class="rg-time">{r.time}</span>{/if}
							<span class="rg-name">{r.name}</span>
						</span>
						<span class="rg-what">{r.what}</span>
					</span>
				</label>
			</li>
		{/each}
	</ul>
</div>

<style>
	.rg {
		display: flex;
		gap: var(--size-4-4);
		max-height: 65vh;
		min-height: 0;
	}
	.rg-day {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--kairos-radius-l);
		padding: var(--size-4-2) var(--size-4-2) var(--size-4-2) 0;
	}
	.rg-body {
		display: flex;
		min-width: 0;
	}
	.rg-col {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.rg-list {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
	}
	.rg-row {
		display: flex;
		align-items: flex-start;
		gap: var(--size-4-2);
		padding: var(--size-4-1) var(--size-4-2);
		border-radius: var(--kairos-radius-m);
		cursor: pointer;
	}
	.rg-row:hover {
		background: var(--background-modifier-hover);
	}
	.rg-row input {
		margin-top: 2px;
		flex-shrink: 0;
	}
	.rg-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.rg-line {
		display: flex;
		gap: var(--size-4-2);
		align-items: baseline;
	}
	.rg-time {
		font-size: var(--kairos-text-label);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.rg-name {
		font-size: var(--font-ui-small);
		color: var(--text-normal);
	}
	.rg-what {
		font-size: var(--kairos-text-label);
		color: var(--text-muted);
	}
	.rg-row.is-off .rg-name,
	.rg-row.is-off .rg-time {
		color: var(--text-faint);
	}
	@media (max-width: 600px) {
		.rg {
			flex-direction: column;
			max-height: none;
		}
		.rg-day {
			max-height: 45vh;
		}
	}
</style>
