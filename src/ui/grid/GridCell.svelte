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
		// Jump to this task's block in the Day view (badge ctrl+click).
		onReveal: (task: ResolvedTask) => void;
		// Open the block picker to change a nested task's parent block, anchored at
		// `rect`. Wired only for non-colocated tasks (a checkable block can't move).
		onNest: (task: ResolvedTask, anchor: DOMRect) => void;
		// Move a nested task out of its day and into the backlog. Not offered for
		// a colocated task — that task is a block, which can't leave its line.
		onMoveToBacklog: (task: ResolvedTask) => void;
		// A long-press on a regular task began a grid drag-to-reschedule.
		onTaskGrab?: (task: ResolvedTask, event: PointerEvent) => void;
		// A long-press on a colocated task (checkable block) began a block drag.
		onBlockGrab?: (task: ResolvedTask, event: PointerEvent) => void;
		// While a drag is live: dim the source item. dragTaskLine for task drags,
		// dragBlockLine for block drags (matches the block's source line = colocated task line).
		dragTaskLine?: number;
		dragBlockLine?: number;
		// True only when THIS cell is the live drop target (not just any drag).
		isDropTarget?: boolean;
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
		onNest,
		onMoveToBacklog,
		onTaskGrab,
		onBlockGrab,
		dragTaskLine,
		dragBlockLine,
		isDropTarget = false,
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
	function blockGrabOf(task: Task, event: PointerEvent) {
		if (onBlockGrab) onBlockGrab(task as ResolvedTask, event);
	}
</script>

<div class="grid-cell" class:drop-target={isDropTarget}>
	{#each tasks as task, i (task.source.path + ":" + task.source.line)}
		<div
			class="grid-cell-item"
			class:dragging-origin={dragTaskLine === task.source.line || (task.colocated && dragBlockLine === task.block.source.line)}
			data-task-index={i}
		>
			<Task_
				{task}
				{color}
				onSetStatus={statusOf}
				onSetText={textOf}
				onDelete={deleteOf}
				onNest={!task.colocated && onNest ? (rect) => onNest(task, rect) : undefined}
				nestLabel="Change parent block"
				onMoveToBacklog={task.colocated
					? undefined
					: () => onMoveToBacklog(task)}
				meta={task.colocated ? blockBadge : isNested(task) ? nestedBadge : undefined}
				onGrab={task.colocated
					? onBlockGrab ? (e) => blockGrabOf(task, e) : undefined
					: onTaskGrab ? (e) => grabOf(task, e) : undefined}
			/>

			<!-- The block-nesting badge renders inside the Task (via its `meta`
			     snippet) so it shares the row's hover region and lines up with the
			     association line. Styled with `.grid-cell-badge` to mirror it. -->
			{#snippet blockBadge()}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="grid-cell-badge linked"
					title="Ctrl+click to open in Day view"
					onclick={(e) => { if (e.ctrlKey || e.metaKey) onReveal(task); }}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
					<span class="grid-cell-badge-label">
						{badgeLabel(task)}
						<span class="grid-cell-badge-block-number">
							{task.block.tasks.length > 0 ? ` +${task.block.tasks.length}` : ""}
						</span>
					</span>
				</div>
			{/snippet}
			{#snippet nestedBadge()}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="grid-cell-badge linked"
					title="Ctrl+click to open in Day view"
					onclick={(e) => { if (e.ctrlKey || e.metaKey) onReveal(task); }}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
					<span class="grid-cell-badge-label">{badgeLabel(task)}</span>
				</div>
			{/snippet}
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

	/* Highlight the whole cell when it is the live drop target.
	   Inset box-shadow instead of outline so it isn't clipped by the grid table's overflow:hidden. */
	.grid-cell.drop-target {
		box-shadow: inset 0 0 0 2px var(--interactive-accent);
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
		margin-top: 2px;
		padding: 2px 6px;
		font-size: 11px;
		color: var(--text-muted);
		background: transparent;
		border-radius: 5px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.1s;
		box-shadow: none;
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

	/* ── Nested-task block badge ── */
	.grid-cell-item {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	/* The block association mirrors Task's association line (.k-task-assoc): a
	   flat icon + label in muted text, aligned under the task text past the
	   checkbox. Ctrl+click reveals it in the Day view — signalled, like the assoc
	   line, by a pointer cursor and a hover underline on `.linked`. No pill, no
	   hover fill — it reads as the same kind of metadata as the assoc tag. */
	.grid-cell-badge {
		display: flex;
		align-items: center;
		gap: 3px;
		padding-left: 24px;
		font-size: 10px;
		color: var(--text-muted);
		min-width: 0;
	}
	.grid-cell-badge.linked {
		cursor: pointer;
	}
	.grid-cell-badge.linked:hover .grid-cell-badge-label {
		text-decoration: underline;
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
	.grid-cell-badge-block-number {
		background: color-mix(
			in srgb,
			var(--interactive-accent) 20%,
			var(--background-modifier-border)
		);
	}
</style>
