<script lang="ts">
	// One (row × day) cell of the Grid. Renders the resolved tasks that belong to
	// this cell as `Task` rows, and offers a "+" to create a new task in this
	// day, auto-associated with the row (spec §5). It owns no data and no writes:
	// every mutation is an intent forwarded to the parent (GridView), which holds
	// the day's blocks and persists through the index. That keeps all task
	// read/write logic in one place and this component purely presentational.

	import type { Association, ResolvedTask, Task, TaskStatus } from "../../types";
	import type { Resolver } from "../../index";
	import Task_ from "../task/Task.svelte";

	interface Props {
		tasks: ResolvedTask[];
		resolve: Resolver;
		/** Row tint, applied to task checkboxes for a domain-colored accent. */
		color?: string;
		/** True on the Unassigned row, where "+" would have no association. */
		allowCreate: boolean;
		onSetStatus: (task: ResolvedTask, status: TaskStatus) => void;
		onSetText: (task: ResolvedTask, text: string) => void;
		onDelete: (task: ResolvedTask) => void;
		onEditAssoc: (task: ResolvedTask, anchor: DOMRect) => void;
		onNavigate: (assoc: Association) => void;
		onCreate: () => void;
		// Jump to this task's block in the Day view (badge click).
		onReveal: (task: ResolvedTask) => void;
		// Unnest: move this task out of its timed block into Unscheduled.
		onUnnest: (task: ResolvedTask) => void;
		// A long-press on a task began a grid drag-to-reschedule. The parent takes over.
		onTaskGrab?: (task: ResolvedTask, event: PointerEvent) => void;
		// While a task drag is live: the source task's line (to dim it) and the
		// live insertion slot for this cell (to show a drop indicator).
		dragTaskLine?: number;
		dropIndex?: number;
		// True while ANY task drag is active — shows the drop zone even when empty.
		dragActive?: boolean;
	}

	let {
		tasks,
		resolve,
		color,
		allowCreate,
		onSetStatus,
		onSetText,
		onDelete,
		onEditAssoc,
		onNavigate,
		onCreate,
		onReveal,
		onUnnest,
		onTaskGrab,
		dragTaskLine,
		dropIndex,
		dragActive = false,
	}: Props = $props();

	// A scheduled task shows a badge = its block's time + title. "Scheduled" here
	// means nested in a *timed* block (a task in Unscheduled is not). You schedule
	// blocks, not tasks — this badge surfaces the block a task borrows time from.
	function isNested(task: ResolvedTask): boolean {
		return task.scheduled && task.block.time !== undefined;
	}

	function fmtTime(min: number): string {
		const h = Math.floor(min / 60);
		const m = min % 60;
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}

	function badgeLabel(task: ResolvedTask): string {
		const t = task.block.time;
		const time = t ? fmtTime(t.start) : "";
		return `${time} ${task.block.title}`.trim();
	}

	// `Task` speaks in bare `Task`s; our callbacks want the `ResolvedTask` (it
	// carries the day + block needed to route the write). The rendered list is
	// resolved tasks, so we can pass each straight through.
	function statusOf(task: Task, status: TaskStatus) {
		onSetStatus(task as ResolvedTask, status);
	}
	function textOf(task: Task, text: string) {
		onSetText(task as ResolvedTask, text);
	}
	function deleteOf(task: Task) {
		onDelete(task as ResolvedTask);
	}
	function grabOf(task: Task, event: PointerEvent) {
		if (onTaskGrab) onTaskGrab(task as ResolvedTask, event);
	}
</script>

<div class="grid-cell">
	{#each tasks as task, i (task.source.path + ":" + task.source.line)}
		{#if dropIndex === i}
			<div class="grid-drop-line"></div>
		{/if}
		<div
			class="grid-cell-item"
			class:dragging-origin={dragTaskLine === task.source.line}
			data-task-index={i}
		>
			<Task_
				{task}
				{color}
				onSetStatus={statusOf}
				onSetText={textOf}
				onDelete={deleteOf}
				onGrab={onTaskGrab && !task.colocated ? (e) => grabOf(task, e) : undefined}
			/>

			{#if task.colocated}
				<!-- Colocated = a checkable block. Show a clock-badge with the block
				     time so it's clear this item is anchored to a scheduled block.
				     Not draggable — move the block from the timeline instead. -->
				<div class="grid-cell-badge-row">
					<button
						class="grid-cell-badge grid-cell-badge-block"
						title="Open in Day view"
						onclick={() => onReveal(task)}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
						<span class="grid-cell-badge-label">{badgeLabel(task)}</span>
					</button>
				</div>
			{:else if isNested(task)}
				<!-- Nested task: show the block time badge + unnest button. -->
				<div class="grid-cell-badge-row">
					<button
						class="grid-cell-badge"
						title="Open in Day view"
						onclick={() => onReveal(task)}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
						<span class="grid-cell-badge-label">{badgeLabel(task)}</span>
					</button>
					<button
						class="grid-cell-unnest"
						title="Unnest — move to Unscheduled"
						aria-label="Unnest task"
						onclick={() => onUnnest(task)}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
					</button>
				</div>
			{/if}
		</div>
	{/each}

	<!-- Trailing drop zone: append indicator after the last task row. -->
	{#if dragActive}
		<div class="grid-drop-tail">
			{#if dropIndex !== undefined && dropIndex >= tasks.length}
				<div class="grid-drop-line"></div>
			{/if}
		</div>
	{/if}

	{#if allowCreate}
		<button class="grid-cell-add" title="Add task" onclick={onCreate}>
			<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
			<span>Task</span>
		</button>
	{/if}
</div>

<style>
	.grid-cell {
		display: flex;
		flex-direction: column;
		min-height: 44px;
		padding: 4px;
		gap: 1px;
		min-width: 0;
	}

	/* Insertion indicator between task rows (or at the list ends). */
	.grid-drop-line {
		height: 0;
		border-top: 2px solid var(--interactive-accent);
		margin: -1px 0;
	}

	/* Trailing drop zone: padded home for the append indicator. */
	.grid-drop-tail {
		min-height: 6px;
		flex-shrink: 0;
	}

	/* Dim the row whose task is being dragged. */
	.grid-cell-item.dragging-origin {
		opacity: 0.35;
	}

	/* The add affordance stays quiet until the cell is hovered, so a dense grid
	   doesn't read as a wall of buttons. */
	.grid-cell-add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		align-self: flex-start;
		margin-top: 2px;
		padding: 2px 6px;
		font-size: 11px;
		color: var(--text-muted);
		background: transparent;
		border: 1px dashed var(--background-modifier-border);
		border-radius: 5px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.1s;
	}

	.grid-cell:hover .grid-cell-add {
		opacity: 0.75;
	}

	.grid-cell-add:hover {
		opacity: 1;
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.grid-cell-add svg {
		flex-shrink: 0;
	}

	/* ── Nested-task block badge + unnest ── */
	.grid-cell-item {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.grid-cell-badge-row {
		display: flex;
		align-items: center;
		gap: 3px;
		/* Align under the task text, past the checkbox (matches Task's assoc line). */
		padding-left: 28px;
		min-width: 0;
	}

	.grid-cell-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		max-width: 100%;
		padding: 0 5px;
		height: 16px;
		font-size: 10px;
		color: var(--text-muted);
		background: var(--background-modifier-border);
		border: none;
		border-radius: 7px;
		cursor: pointer;
		min-width: 0;
	}
	.grid-cell-badge:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	/* Colocated block badge gets a slightly warmer tint to distinguish it
	   from a plain nested-task time badge. */
	.grid-cell-badge-block {
		background: color-mix(
			in srgb,
			var(--interactive-accent) 12%,
			var(--background-modifier-border)
		);
	}
	.grid-cell-badge-block:hover {
		background: color-mix(
			in srgb,
			var(--interactive-accent) 20%,
			var(--background-modifier-border)
		);
	}
	.grid-cell-badge svg {
		flex-shrink: 0;
	}
	.grid-cell-badge-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-variant-numeric: tabular-nums;
	}

	.grid-cell-unnest {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--text-faint);
		cursor: pointer;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity 0.1s;
	}
	.grid-cell-item:hover .grid-cell-unnest {
		opacity: 1;
	}
	.grid-cell-unnest:hover {
		color: var(--text-error);
		background: var(--background-modifier-hover);
		border-radius: 4px;
	}
</style>
