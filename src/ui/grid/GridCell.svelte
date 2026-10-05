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
		/**
		 * The row's entity was inactive/archived on this day: the cell is history,
		 * shown dimmed and read-only (existing tasks visible, no "+" to add work to
		 * a period the project/domain wasn't active in).
		 */
		inactive?: boolean;
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
		// Move a task off this day and back into the backlog. Wired only for
		// non-colocated tasks — a colocated task is a block, which can't leave
		// its line.
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
		inactive = false,
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

<div class="grid-cell" class:drop-target={isDropTarget} class:inactive>
	{#if inactive}
		<!-- Read-only history: a project/domain that wasn't active on this day. The
		     dim/hatch reads the column as past context, not a place to add work. -->
		<div class="grid-cell-inactive-badge" title="Not active on this day"></div>
	{/if}
	{#each tasks as task, i (task.source.path + ":" + task.source.line)}
		{@const tr = task.owner ? resolve(task.owner) : undefined}
		<div
			class="grid-cell-item"
			class:dragging-origin={dragTaskLine === task.source.line || (task.colocated && dragBlockLine === task.block.source.line)}
			data-task-index={i}
		>
			<Task_
				{task}
				lines={2}
				color={color ?? tr?.color}
				association={task.owner}
				showAssociation={false}
				inherited={task.assoc === undefined && task.owner !== undefined}
				resolved={tr}
				onNavigate={() => task.owner && onNavigate(task.owner)}
				onEditAssoc={(rect) => onEditAssoc(task, rect)}
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
			     association line. It wears the shared `.kairos-meta` classes from
			     styles.css — the same rules the association line uses — because a
			     snippet is compiled here, not in `Task`, so Task's scoped styles
			     can never reach it. That is what the old hand-copied
			     `.grid-cell-badge` block was working around. -->
			{#snippet blockBadge()}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="kairos-meta is-linked"
					title="Ctrl+click to open in Day view"
					onclick={(e) => { if (e.ctrlKey || e.metaKey) onReveal(task); }}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
					<span class="kairos-meta-label">{badgeLabel(task)}</span>
					<!-- How many other tasks sit in that block. Its own element beside
					     the label, not inside it: nested in the ellipsizing label it was
					     the first thing truncation ate. -->
					{#if task.block.tasks.length > 0}
						<span class="kairos-meta-count">+{task.block.tasks.length}</span>
					{/if}
				</div>
			{/snippet}
			{#snippet nestedBadge()}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="kairos-meta is-linked"
					title="Ctrl+click to open in Day view"
					onclick={(e) => { if (e.ctrlKey || e.metaKey) onReveal(task); }}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
					<span class="kairos-meta-label">{badgeLabel(task)}</span>
				</div>
			{/snippet}
		</div>
	{/each}

	{#if allowCreate && !inactive}
		<button class="grid-cell-add" title="Add task" aria-label="Add task" onclick={onCreate}>
			<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
		</button>
	{/if}
</div>

<style>
	.grid-cell {
		/* Anchors the corner "+" (see .grid-cell-add). */
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 32px;
		/* A slightly deeper bottom edge leaves a strip below the last task where
		   the corner "+" can be reached without hovering that task. */
		padding: 4px 4px 8px;
		gap: 1px;
		min-width: 0;
	}

	/* Highlight the whole cell when it is the live drop target.
	   Inset box-shadow instead of outline so it isn't clipped by the grid table's overflow:hidden. */
	.grid-cell.drop-target {
		box-shadow: inset 0 0 0 2px var(--interactive-accent);
	}

	/* Read-only history: the entity wasn't active on this day. Dim the existing
	   tasks and lay a faint hatch behind them (matching the empty-cell hatch) so
	   the column reads as past context, not an editable slot. Pointer events on
	   the tasks stay live so the user can still open/inspect them. */
	.grid-cell.inactive .grid-cell-item {
		opacity: 0.4;
	}
	.grid-cell-inactive-badge {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: repeating-linear-gradient(
			45deg,
			transparent,
			transparent 6px,
			var(--background-modifier-border) 6px,
			var(--background-modifier-border) 7px
		);
		opacity: 0.25;
	}

	/* Dim the row whose task is being dragged. */
	.grid-cell-item.dragging-origin {
		opacity: 0.35;
	}

	/* The add affordance floats in the cell's bottom-right corner, so it takes
	   no room in the layout: a cell is only as tall as its tasks. It stays
	   hidden until the cell is hovered, so a dense grid doesn't read as a wall
	   of buttons. Tasks carry their own action bar at their top-right, so the
	   "+" stands down (hidden and click-through) while any task's bar in the
	   cell is awake — the two never compete for the same spot, and hovering the
	   body of a task leaves the "+" alone. */
	.grid-cell-add {
		position: absolute;
		bottom: 2px;
		right: 4px;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		border-radius: var(--radius-s);
		color: var(--text-muted);
		background: var(--background-primary);
		box-shadow: none;
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

	/* `kairos-actions-awake` is set by the shared actionZone action (#44) while
	   the pointer is in a row's corner zone, i.e. exactly while its bar shows. */
	.grid-cell:has(:global(.kairos-actions-awake)) .grid-cell-add {
		opacity: 0;
		pointer-events: none;
	}

	/* Touch screens have no hover, so keep it faintly visible there. */
	@media (hover: none) {
		.grid-cell-add {
			opacity: 0.45;
		}

		/* Touch has no corner zone: a tapped task shows its bar on its (sticky)
		   hover, so stand down for that instead. */
		.grid-cell:has(:global(.k-task:hover)) .grid-cell-add {
			opacity: 0;
			pointer-events: none;
		}
	}

	/* ── Nested-task block badge ── */
	.grid-cell-item {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	/* The block badge itself carries no local styling: it is a `.kairos-meta`
	   item (styles.css), the same rule the association line uses, rendered inside
	   Task's meta row — which supplies the alignment past the checkbox. Ctrl+click
	   reveals it in the Day view, signalled by `.is-linked` exactly as the
	   association line signals it. */
</style>
