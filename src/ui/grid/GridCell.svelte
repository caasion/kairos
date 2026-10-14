<script lang="ts">
	// One (row × day) cell of the Grid. Renders the resolved tasks that belong to
	// this cell as `Task` rows, and offers a "+" to create a new task in this
	// day, auto-associated with the row (spec §5). It owns no data and no writes:
	// every mutation is an intent forwarded to the parent (GridView), which holds
	// the day's blocks and persists through the index. That keeps all task
	// read/write logic in one place and this component purely presentational.
	//
	// Tasks sit under their block's header, in time order with Unscheduled last,
	// and a timed block shows in its own row even with no tasks there (decision
	// 95). A checkable block's own task is its header. The header does what the
	// old per-task badge did: Ctrl/Cmd+click opens the block in the Day view,
	// pointing at it lights the block in other views, and a task dropped on it
	// nests there. Nothing renders under a task (decision 72).

	import type { Association, Block, ISODate, ResolvedTask, Task, TaskStatus } from "../../types";
	import type { Resolver } from "../../index";
	import { isUnscheduledBlock, type BlockGroup } from "../../gridModel";
	import type { Highlight } from "../../viewLinks";
	import Task_ from "../task/Task.svelte";
	import { requestRepeat } from "../../routines/repeat";

	interface Props {
		resolve: Resolver;
		/** Row tint, applied to task checkboxes for a domain-colored accent. */
		color?: string;
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
		// Jump to this task's block in the Day view.
		onReveal: (task: ResolvedTask) => void;
		// Jump to a block in the Day view (its header's ctrl+click).
		onRevealBlock: (block: Block) => void;
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
		// Hover link (viewLinks.ts): how a task is lit (its block, or itself), and
		// the report of the pointer entering/leaving one here.
		highlightOf?: (task: ResolvedTask) => Highlight;
		onHover?: (task: ResolvedTask, on: boolean) => void;
		// The cell's block groups and the chip naming a rolled-up task's project.
		// Each group is a drop target
		// (see taskDrag's `hitTestGridGroup`): `dropGroup` is the one a live drag
		// would land in (a block line, or "unscheduled"), and `unscheduledSlot`
		// shows an empty Unscheduled group to drop into while a drag is live.
		blockGroups: BlockGroup[];
		chipFor?: (task: ResolvedTask) => string | undefined;
		date?: ISODate;
		dropGroup?: number | "unscheduled";
		unscheduledSlot?: boolean;
		// Add a new task to a group's block (its "+").
		onCreateInBlock?: (block: Block) => void;
		// Hover link for the block headers: whether a block is lit (pointed at in
		// some row or view), and a header coming under / leaving the pointer.
		isBlockLinked?: (block: Block) => boolean;
		onBlockHover?: (block: Block, on: boolean) => void;
	}

	let {
		resolve,
		color,
		inactive = false,
		onSetStatus,
		onSetText,
		onDelete,
		onEditAssoc,
		onNavigate,
		onCreate,
		onReveal,
		onRevealBlock,
		onNest,
		onMoveToBacklog,
		onTaskGrab,
		onBlockGrab,
		dragTaskLine,
		dragBlockLine,
		isDropTarget = false,
		highlightOf,
		onHover,
		blockGroups,
		chipFor,
		date,
		dropGroup,
		unscheduledSlot = false,
		onCreateInBlock,
		isBlockLinked,
		onBlockHover,
	}: Props = $props();

	const canCreate = $derived(!inactive);
	// Grouped, each group carries its own "+", and an Unscheduled group's adds
	// to Unscheduled; the cell's corner "+" stays only for a cell without one.
	const showCellAdd = $derived(
		canCreate &&
			!blockGroups.some((g) => isUnscheduledBlock(g.block)),
	);

	// The value `dropGroup` takes when a drag is over this group.
	function dropKey(group: BlockGroup): number | "unscheduled" {
		return isUnscheduledBlock(group.block) ? "unscheduled" : group.block.source.line;
	}

	// Each block group's offset into the cell's flat task order (its own task
	// first, then its nested ones), so `data-task-index` runs across the cell.
	const blockOffsets = $derived.by(() => {
		let n = 0;
		return blockGroups.map((g) => {
			const at = n;
			n += (g.head ? 1 : 0) + g.tasks.length;
			return at;
		});
	});

	// A block's highlight color: its domain color, else the row's tint (and the
	// theme accent when neither has one).
	function blockColor(block: Block): string | undefined {
		return (block.assoc ? resolve(block.assoc).color : undefined) ?? color;
	}

	function headerLabel(block: Block): string {
		return block.time ? `${fmtTime(block.time.start)} ${block.title}` : block.title;
	}

	// A header removed while the pointer is on it (its last task dropped
	// elsewhere) gets no leave event; report the leave on removal instead, or the
	// block would stay lit in every view. Harmless when it isn't the hover.
	function leaveOnRemove(_node: HTMLElement, leave: () => void) {
		let current = leave;
		return {
			update(next: () => void) {
				current = next;
			},
			destroy() {
				current();
			},
		};
	}

	function onBlockHeaderClick(e: MouseEvent, group: BlockGroup) {
		if (!(e.ctrlKey || e.metaKey) || !group.block.time) return;
		e.preventDefault();
		e.stopPropagation();
		onRevealBlock(group.block);
	}

	function fmtTime(min: number): string {
		const h = Math.floor(min / 60);
		const m = min % 60;
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
	{#snippet taskItem(task: ResolvedTask, i: number, lead?: string, addInside?: () => void, addLabel?: string)}
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
				onRepeat={() => requestRepeat(task, task.block)}
				{lead}
				onAddInside={addInside}
				addInsideLabel={addLabel}
				trailing={chipFor?.(task)}
				onGrab={task.colocated
					? onBlockGrab ? (e) => blockGrabOf(task, e) : undefined
					: onTaskGrab ? (e) => grabOf(task, e) : undefined}
				highlight={highlightOf?.(task) ?? null}
				onHoverChange={onHover ? (on: boolean) => onHover(task, on) : undefined}
			/>
		</div>
	{/snippet}

	{#each blockGroups as group, g (group.key)}
		{@const at = blockOffsets[g] ?? 0}
		<!-- The whole group (header and tasks) is one drop target: a task
		     dropped anywhere on it nests in this block. The Unscheduled group
		     carries no block line, so a drop there takes a task out of its
		     block instead. -->
		<div
			class="grid-cell-block-group"
			class:drop-target={dropGroup === dropKey(group)}
			data-grid-drop-date={date}
			data-grid-drop-block={isUnscheduledBlock(group.block) ? undefined : group.block.source.line}
		>
			{#if group.head}
				<!-- A checkable block heads its own group: its task row, with the
				     start time before the title. -->
				<!-- Its "+" lives in the row's own action bar, in the top-right
				     corner, so it doesn't fight the row's corner zone. -->
				{@render taskItem(
					group.head,
					at,
					group.block.time ? fmtTime(group.block.time.start) : undefined,
					canCreate && onCreateInBlock ? () => onCreateInBlock(group.block) : undefined,
					`Add task to ${group.block.title}`,
				)}
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="grid-cell-group-header grid-cell-block-header"
					class:unscheduled={isUnscheduledBlock(group.block)}
					class:linked={isBlockLinked?.(group.block) ?? false}
					style:--kairos-link-color={blockColor(group.block)}
					title={group.block.time ? "Ctrl+click to open in Day view" : undefined}
					onclick={(e) => onBlockHeaderClick(e, group)}
					onpointerenter={() => onBlockHover?.(group.block, true)}
					onpointerleave={() => onBlockHover?.(group.block, false)}
					use:leaveOnRemove={() => onBlockHover?.(group.block, false)}
				>
					{headerLabel(group.block)}
				</div>
			{/if}
			{#each group.tasks as task, j (task.source.path + ":" + task.source.line)}
				{@render taskItem(task, at + (group.head ? 1 : 0) + j)}
			{/each}
			{#if canCreate && onCreateInBlock && !group.head}
				<!-- A plain header's "+", at the right end of the header line. -->
				<button
					class="grid-cell-group-add"
					title={isUnscheduledBlock(group.block) ? "Add task" : `Add task to ${group.block.title}`}
					aria-label={isUnscheduledBlock(group.block) ? "Add task" : `Add task to ${group.block.title}`}
					onclick={() => onCreateInBlock(group.block)}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
				</button>
			{/if}
		</div>
	{/each}
	{#if unscheduledSlot}
		<!-- While a task is being dragged, a cell with no Unscheduled group
		     offers an empty one, so a task can always be dropped out of its
		     block. -->
		<div
			class="grid-cell-block-group grid-cell-unscheduled-slot"
			class:drop-target={dropGroup === "unscheduled"}
			data-grid-drop-date={date}
		>
			<div class="grid-cell-group-header grid-cell-block-header unscheduled">Unscheduled</div>
		</div>
	{/if}

	{#if showCellAdd && !unscheduledSlot}
		<!-- No Unscheduled group here yet, so the cell's "+" wears the header that
		     group would have: it says where a new task goes. Shown on hover only.
		     In an empty cell it sits where the group would; under other groups
		     it floats over the cell's bottom edge, so it takes no room. -->
		<button
			class="grid-cell-add"
			class:floating={blockGroups.length > 0}
			title="Add task to Unscheduled"
			aria-label="Add task to Unscheduled"
			onclick={onCreate}
		>
			<span class="grid-cell-add-label">Unscheduled</span>
			<span class="grid-cell-add-icon">
				<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
			</span>
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

	.grid-cell.inactive .grid-cell-group-header {
		opacity: 0.4;
	}

	/* A group header: small and muted, so it labels the tasks below it without
	   competing with them. */
	.grid-cell-group-header {
		padding: 0 2px;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		cursor: default;
	}
	.grid-cell-group-header:hover {
		color: var(--text-normal);
	}

	/* ── Block groups ── */
	/* A block header starts a group; a little air above every one but the first.
	   Tabular digits keep the times lined up down a column. */
	.grid-cell-block-header {
		/* Start the header where task text starts (the row's 4px padding plus the
		   checkbox and its gap), so its time lines up with a checkable block's
		   time and with the task text under it. */
		padding-left: calc(4px + var(--kairos-meta-indent));
		/* Room at the right end for the group's "+", so it never covers the title. */
		padding-right: 24px;
		/* The same type as a checkable block's time and the task text. */
		font-size: 12px;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
		/* Wrap to two lines like a task: a block with no tasks here is the
		   cell's item, not just a label. */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		white-space: normal;
		overflow-wrap: anywhere;
	}
	.grid-cell-block-header.unscheduled {
		font-style: italic;
	}
	/* Hover link: this block, or a task in it, is under the pointer in some row
	   or view (this header included). Tinted like the tasks under it, so the
	   group lights up as one. */
	.grid-cell-block-header.linked {
		color: var(--text-normal);
		background: color-mix(
			in srgb,
			var(--kairos-link-color, var(--interactive-accent)) 12%,
			transparent
		);
	}
	/* One block's header and tasks: a column, and one drop target. */
	.grid-cell-block-group {
		/* Anchors the group's "+" (see .grid-cell-group-add). */
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		border-radius: var(--radius-s);
	}
	.grid-cell-block-group + .grid-cell-block-group {
		margin-top: 4px;
	}
	/* A live task drag would land in this block: outline the whole group. */
	.grid-cell-block-group.drop-target {
		box-shadow: inset 0 0 0 1.5px var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
	}
	.grid-cell-block-group.drop-target .grid-cell-block-header {
		color: var(--text-normal);
	}
	/* The empty Unscheduled slot shown during a drag: a dashed outline so it
	   reads as a place to drop, not a group with tasks. */
	.grid-cell-unscheduled-slot {
		outline: 1px dashed var(--background-modifier-border);
		outline-offset: -1px;
		padding-block: 2px;
	}
	.grid-cell-unscheduled-slot.drop-target {
		outline-color: transparent;
	}

	/* Dim the row whose task is being dragged. */
	.grid-cell-item.dragging-origin {
		opacity: 0.35;
	}

	/* The cell's "+", dressed as the Unscheduled header it adds to: the same
	   italic label in the same place, with the "+" at the right end where a
	   group's "+" sits. It stays hidden until the cell is hovered, so a dense
	   grid doesn't read as a wall of buttons. Tasks carry their own action bar
	   at their top-right, so it stands down (hidden and click-through) while
	   any task's bar in the cell is awake. */
	.grid-cell-add {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
		height: auto;
		min-height: 18px;
		/* Lined up with a real group header (see .grid-cell-block-header). */
		padding: 0 4px 0 calc(4px + var(--kairos-meta-indent));
		border: none;
		border-radius: var(--radius-s);
		color: var(--text-muted);
		background: transparent;
		box-shadow: none;
		font-size: 12px;
		line-height: 1.4;
		font-weight: normal;
		text-align: left;
		cursor: pointer;
		opacity: 0;
		/* Hidden means inert: an invisible "+" must not catch the pointer. It sits
		   above the rows (z-index), so it would otherwise cut through a task's
		   action stack hanging down over it and drop the stack. */
		pointer-events: none;
		transition: opacity 0.1s;
	}
	/* Under other groups: over the cell's bottom edge, out of the layout, so a
	   cell is only as tall as its tasks. Opaque, since it can cover the end of
	   the last task — it only shows while the pointer is off every group. */
	.grid-cell-add.floating {
		position: absolute;
		left: 4px;
		right: 4px;
		bottom: 2px;
		width: auto;
		z-index: 3;
		background: var(--background-primary);
	}
	:global(.grid-datacell.today) .grid-cell-add.floating {
		background: color-mix(
			in srgb,
			var(--interactive-accent) 5%,
			var(--background-primary)
		);
	}
	.grid-cell-add-label {
		flex: 1;
		min-width: 0;
		font-style: italic;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.grid-cell-add-icon {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-s);
		opacity: 0.75;
	}

	.grid-cell:hover .grid-cell-add {
		opacity: 1;
		pointer-events: auto;
	}

	.grid-cell-add:hover {
		color: var(--text-normal);
	}
	.grid-cell-add:hover .grid-cell-add-icon {
		opacity: 1;
		background: var(--background-modifier-hover);
	}

	/* `kairos-actions-awake` is set by the shared actionZone action (#44) while
	   the pointer is in a row's corner zone, i.e. exactly while its bar shows. */
	.grid-cell:has(:global(.kairos-actions-awake)) .grid-cell-add {
		opacity: 0;
		pointer-events: none;
	}

	/* A block group's "+", in the group's top-right corner on its header line. It
	   shows while the pointer is on that group, and stands down while a task's
	   action bar is awake. (A checkable block's group has no header line; its
	   "+" is in its own row's action bar instead.) */
	.grid-cell-group-add {
		position: absolute;
		top: 0;
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
		/* Inert while hidden, like the cell's "+". */
		pointer-events: none;
		transition: opacity 0.1s;
	}
	.grid-cell-block-group:hover > .grid-cell-group-add {
		opacity: 0.75;
		pointer-events: auto;
	}
	.grid-cell-group-add:hover {
		opacity: 1;
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}
	.grid-cell-block-group:has(:global(.kairos-actions-awake)) > .grid-cell-group-add {
		opacity: 0;
		pointer-events: none;
	}
	/* Over a group, the group's "+" is the one to use. */
	.grid-cell:has(.grid-cell-block-group:hover) .grid-cell-add {
		opacity: 0;
		pointer-events: none;
	}

	/* Touch screens have no hover, so keep it faintly visible there. */
	@media (hover: none) {
		.grid-cell-add,
		.grid-cell-group-add {
			opacity: 0.45;
			pointer-events: auto;
		}
		/* Just the "+" on touch, in the corner: a label always showing in every
		   cell would be noise. */
		.grid-cell-add {
			justify-content: flex-end;
			padding: 0;
		}
		.grid-cell-add-label {
			display: none;
		}
		.grid-cell-add.floating {
			left: auto;
		}
		.grid-cell-block-group:has(:global(.k-task:hover)) > .grid-cell-group-add {
			opacity: 0;
			pointer-events: none;
		}

		/* Touch has no corner zone: a tapped task shows its bar on its (sticky)
		   hover, so stand down for that instead. */
		.grid-cell:has(:global(.k-task:hover)) .grid-cell-add {
			opacity: 0;
			pointer-events: none;
		}
	}

	.grid-cell-item {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
</style>
