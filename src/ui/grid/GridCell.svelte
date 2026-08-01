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
</script>

<div class="grid-cell">
	{#each tasks as task (task.source.path + ":" + task.source.line)}
		{@const r = task.owner ? resolve(task.owner) : undefined}
		<div class="grid-cell-item">
			<Task_
				{task}
				{color}
				association={task.owner}
				inherited={task.assoc === undefined && task.owner !== undefined}
				resolved={r}
				onNavigate={() => task.owner && onNavigate(task.owner)}
				onEditAssoc={(rect) => onEditAssoc(task, rect)}
				onSetStatus={statusOf}
				onSetText={textOf}
				onDelete={deleteOf}
			/>

			{#if isNested(task)}
				<!-- Block badge: what block this task borrows time from. Click jumps
				     to the Day view. A genuine nested task can be unnested; a
				     colocated task (a checkable block's own line) cannot — it IS a
				     block, removed by deleting the block in the timeline. -->
				<div class="grid-cell-badge-row">
					<button
						class="grid-cell-badge"
						title="Open in Day view"
						onclick={() => onReveal(task)}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
						<span class="grid-cell-badge-label">{badgeLabel(task)}</span>
					</button>
					{#if !task.colocated}
						<button
							class="grid-cell-unnest"
							title="Unnest — move to Unscheduled"
							aria-label="Unnest task"
							onclick={() => onUnnest(task)}
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/each}

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
