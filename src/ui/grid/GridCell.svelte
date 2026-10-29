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
	// 95). The header does what the
	// old per-task badge did: Ctrl/Cmd+click opens the block in the Day view,
	// pointing at it lights the block in other views, and a task dropped on it
	// nests there. Nothing renders under a task (decision 72).
	//
	// A block's header carries the block's own actions too, as on the timeline:
	// its context menu (shared via blockMenu.ts), an action stack in its corner
	// (delete, add task, association, repeat), a click on the title to rename it, and a long-press to
	// drag it to another row or day.

	import DraftTask from "../task/DraftTask.svelte";
	import { Menu } from "obsidian";
	import type { Association, Block, ISODate, ResolvedTask, Task, TaskStatus } from "../../types";
	import type { Resolver } from "../../index";
	import { isUnscheduledBlock, sourceKey, type BlockGroup } from "../../gridModel";
	import { formatClock } from "../../parser";
	import type { Highlight } from "../../viewLinks";
	import Task_ from "../task/Task.svelte";
	import { requestRepeat, requestRepeatBlock } from "../../routines/repeat";
	import { addBlockMenuItems } from "../blockMenu";
	import { actionZone } from "../actions/actionZone";
	import { grabOnHold } from "../actions/grabOnHold";
	import { tooltip } from "../actions/tooltip";

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
		// PROTOTYPE (add flow): the "+" opened its new-task field in this cell.
		draftOpen?: boolean;
		onDraftSubmit?: (text: string) => void;
		onDraftClose?: () => void;
		// Jump to this task's block in the Day view.
		onReveal: (task: ResolvedTask) => void;
		// Jump to a block in the Day view (its header's ctrl+click).
		onRevealBlock: (block: Block) => void;
		// Open the block picker to change a nested task's parent block, anchored at
		// `rect`.
		onNest: (task: ResolvedTask, anchor: DOMRect) => void;
		// Move a task off this day and back into the backlog.
		onMoveToBacklog: (task: ResolvedTask) => void;
		// A long-press on a regular task began a grid drag-to-reschedule.
		onTaskGrab?: (task: ResolvedTask, event: PointerEvent) => void;
		// A long-press on a block's header began a block drag.
		onBlockGrab?: (block: Block, event: PointerEvent) => void;
		// While a drag is live: dim the source item. dragTaskKey for task drags,
		// dragBlockKey for block drags. Both are "path:line" (sourceKey), so the same line in another day's
		// note doesn't dim too.
		dragTaskKey?: string;
		dragBlockKey?: string;
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
		// A block's own edits, from its header's menu and action stack: the
		// association picker anchored at `rect`, delete, rename.
		onEditBlockAssoc?: (block: Block, anchor: DOMRect) => void;
		onDeleteBlock?: (block: Block) => void;
		onSetBlockTitle?: (block: Block, title: string) => void;
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
		draftOpen = false,
		onDraftSubmit,
		onDraftClose,
		onReveal,
		onRevealBlock,
		onNest,
		onMoveToBacklog,
		onTaskGrab,
		onBlockGrab,
		dragTaskKey,
		dragBlockKey,
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
		onEditBlockAssoc,
		onDeleteBlock,
		onSetBlockTitle,
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

	// Each block group's offset into the cell's flat task order, so `data-task-index` runs across the cell.
	const blockOffsets = $derived.by(() => {
		let n = 0;
		return blockGroups.map((g) => {
			const at = n;
			n += g.tasks.length;
			return at;
		});
	});

	// A block's highlight color: its domain color, else the row's tint (and the
	// theme accent when neither has one).
	function blockColor(block: Block): string | undefined {
		return (block.assoc ? resolve(block.assoc).color : undefined) ?? color;
	}

	function headerLabel(block: Block): string {
		return block.time ? `${formatClock(block.time.start)} ${block.title}` : block.title;
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

	// ── Block actions (a header's menu and stack) ──

	// Each block header, by group key: the association picker's anchor (the
	// stack may be portaled out of the header, so a button can't find it).
	const headerEls: Record<string, HTMLElement> = {};

	function editBlockAssoc(group: BlockGroup) {
		const rect = headerEls[group.key]?.getBoundingClientRect();
		if (rect) onEditBlockAssoc?.(group.block, rect);
	}

	function openBlockMenu(e: MouseEvent, group: BlockGroup) {
		// A right-click in the rename input keeps the input's own menu.
		if ((e.target as Partial<Element> | null)?.closest?.("input, textarea")) return;
		e.preventDefault();
		e.stopPropagation();
		const block = group.block;
		const menu = new Menu();
		addBlockMenuItems(menu, block, {
			onAddTask: canCreate && onCreateInBlock ? () => onCreateInBlock(block) : undefined,
			onEditAssoc: () => editBlockAssoc(group),
			onDelete: () => onDeleteBlock?.(block),
			onReveal: block.time ? () => onRevealBlock(block) : undefined,
		});
		menu.showAtMouseEvent(e);
	}

	// Rename: a click on a header's title edits it in place, like a task's text.
	let renaming = $state<string | null>(null);
	let titleDraft = $state("");
	let titleInputEl = $state<HTMLInputElement>();

	function beginRename(e: MouseEvent, group: BlockGroup) {
		// Ctrl/Cmd+click is "open in Day view" (the header's own handler).
		if (e.ctrlKey || e.metaKey || !onSetBlockTitle) return;
		titleDraft = group.block.title;
		renaming = group.key;
		queueMicrotask(() => titleInputEl?.focus());
	}
	function commitRename(block: Block) {
		if (renaming === null) return;
		renaming = null;
		const next = titleDraft.trim();
		if (next.length > 0 && next !== block.title) onSetBlockTitle?.(block, next);
	}
	function onRenameKeydown(e: KeyboardEvent, block: Block) {
		if (e.key === "Enter") {
			e.preventDefault();
			commitRename(block);
		} else if (e.key === "Escape") {
			e.preventDefault();
			renaming = null;
		}
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

<div class="grid-cell" class:drop-target={isDropTarget} class:inactive>
	{#if inactive}
		<!-- Read-only history: a project/domain that wasn't active on this day. The
		     dim/hatch reads the column as past context, not a place to add work. -->
		<div class="grid-cell-inactive-badge" title="Not active on this day"></div>
	{/if}
	{#snippet taskItem(task: ResolvedTask, i: number)}
		{@const tr = task.owner ? resolve(task.owner) : undefined}
		<div
			class="grid-cell-item"
			class:dragging-origin={dragTaskKey === sourceKey(task.source)}
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
				onNest={(rect) => onNest(task, rect)}
				nestLabel={isUnscheduledBlock(task.block) ? "Nest under block" : "Move to another block"}
				onMoveToBacklog={() => onMoveToBacklog(task)}
				onRepeat={() => requestRepeat(task, task.block)}
				trailing={chipFor?.(task)}
				onGrab={onTaskGrab ? (e) => grabOf(task, e) : undefined}
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
			{#if isUnscheduledBlock(group.block)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="grid-cell-group-header grid-cell-block-header unscheduled"
					class:linked={isBlockLinked?.(group.block) ?? false}
					style:--kairos-link-color={blockColor(group.block)}
					onpointerenter={() => onBlockHover?.(group.block, true)}
					onpointerleave={() => onBlockHover?.(group.block, false)}
					use:leaveOnRemove={() => onBlockHover?.(group.block, false)}
				>
					{headerLabel(group.block)}
				</div>
			{:else}
				{@const block = group.block}
				<!-- A plain block's header: it does what the timeline block does
				     (menu, corner stack, rename, drag), and Ctrl/Cmd+click opens it
				     in the Day view. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="grid-cell-group-header grid-cell-block-header actionable"
					class:linked={isBlockLinked?.(block) ?? false}
					class:dragging-origin={dragBlockKey === group.key}
					style:--kairos-link-color={blockColor(block)}
					title={block.time ? "Ctrl+click to open in Day view" : undefined}
					bind:this={headerEls[group.key]}
					onclick={(e) => onBlockHeaderClick(e, group)}
					oncontextmenu={(e) => openBlockMenu(e, group)}
					onpointerenter={() => onBlockHover?.(block, true)}
					onpointerleave={() => onBlockHover?.(block, false)}
					use:leaveOnRemove={() => onBlockHover?.(block, false)}
					use:actionZone={{ layout: "stack" }}
					use:grabOnHold={onBlockGrab ? (e) => onBlockGrab(block, e) : undefined}
				>
					<!-- Action stack, woken from the header's top-right corner, the
					     same as a timeline block's: delete in the corner, then add
					     task, association and repeat. A press
					     here never arms the header's drag: grabOnHold skips presses
					     on the bar and the rename input (a stopPropagation here
					     can't, as Svelte delegates pointerdown to the root). -->
					<div
						class="grid-cell-block-actions kairos-action-bar"
						onpointerdown={(e) => e.stopPropagation()}
					>
						{#if canCreate && onCreateInBlock}
							<button
								class="grid-cell-block-action"
								aria-label="Add task"
								use:tooltip={"Add task"}
								onclick={() => onCreateInBlock(block)}
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/></svg>
							</button>
						{/if}
						<button
							class="grid-cell-block-action"
							aria-label={block.assoc ? "Edit association" : "Add association"}
							use:tooltip={block.assoc ? "Edit association" : "Add association"}
							onclick={() => editBlockAssoc(group)}
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
						</button>
						{#if block.time}
							<button
								class="grid-cell-block-action"
								aria-label="Repeat…"
								use:tooltip={"Repeat…"}
								onclick={() => requestRepeatBlock(block)}
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
							</button>
						{/if}
						<button
							class="grid-cell-block-action grid-cell-block-action-danger"
							aria-label="Delete block"
							use:tooltip={"Delete block"}
							onclick={() => onDeleteBlock?.(block)}
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
						</button>
					</div>
					{#if renaming === group.key}
						<div class="grid-cell-block-edit">
							{#if block.time}<span class="grid-cell-block-time">{formatClock(block.time.start)}</span>{/if}
							<input
								class="grid-cell-block-input kairos-inline-input"
								type="text"
								bind:value={titleDraft}
								bind:this={titleInputEl}
								onpointerdown={(e) => e.stopPropagation()}
								onkeydown={(e) => onRenameKeydown(e, block)}
								onblur={() => commitRename(block)}
							/>
						</div>
					{:else}
						<span class="grid-cell-block-label">
							{#if block.time}<span class="grid-cell-block-time">{formatClock(block.time.start)}</span>{/if}<span
								class="grid-cell-block-title"
								role="textbox"
								tabindex="0"
								onclick={(e) => beginRename(e, group)}
							>{block.title}</span>
						</span>
					{/if}
				</div>
			{/if}
			{#each group.tasks as task, j (task.source.path + ":" + task.source.line)}
				{@render taskItem(task, at + j)}
			{/each}
			{#if canCreate && onCreateInBlock && isUnscheduledBlock(group.block)}
				<!-- Unscheduled's "+", at the right end of its header line (a
				     block's own "+" is in its header's action stack). -->
				<button
					class="grid-cell-group-add"
					aria-label="Add task to Unscheduled"
					use:tooltip={"Add task to Unscheduled"}
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

	{#if draftOpen && onDraftSubmit && onDraftClose}
		<!-- PROTOTYPE (add flow): typed here, filed in the day's Unscheduled
		     (its badge pulses when it lands). -->
		<DraftTask {color} placeholder="New task, to Unscheduled" onSubmit={onDraftSubmit} onClose={onDraftClose} />
	{:else if showCellAdd && !unscheduledSlot}
		<!-- No Unscheduled group here yet, so the cell's "+" wears the header that
		     group would have: it says where a new task goes. Shown on hover only.
		     In an empty cell it sits where the group would; under other groups
		     it floats over the cell's bottom edge, so it takes no room. -->
		<button
			class="grid-cell-add"
			class:floating={blockGroups.length > 0}
			aria-label="Add task to Unscheduled"
			use:tooltip={"Add task to Unscheduled"}
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
		/* Flush left: the header starts where a task row starts (its 4px
		   padding, the checkbox's left edge), not indented to the task text. */
		padding-left: 4px;
		/* Room at the right end for the group's "+", so it never covers the title. */
		padding-right: 24px;
		/* The same type as the task text. */
		font-size: 12px;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
	}
	.grid-cell-block-header.unscheduled {
		font-style: italic;
	}
	/* A block's own header: it anchors its action stack, and a long-press on
	   it lifts the block, so no text selection paints under the press. */
	.grid-cell-block-header.actionable {
		position: relative;
		overflow: visible;
		user-select: none;
	}
	/* Wrap to two lines like a task: a block with no tasks here is the
	   cell's item, not just a label. (On an inner span, so the action stack
	   isn't caught in the clamp.) */
	.grid-cell-block-label {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		white-space: normal;
		overflow-wrap: anywhere;
		touch-action: none;
	}
	/* The start time, smaller and lighter than the title so the title leads.
	   The rename state wears it too, so the header doesn't jump. */
	.grid-cell-block-time {
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
	}
	.grid-cell-block-label .grid-cell-block-time {
		margin-right: 0.3em;
	}
	/* A click on the title renames the block, as on a task or the timeline. */
	.grid-cell-block-title {
		cursor: text;
	}
	/* A matured hold: tinted so the press reads as registered before the
	   pointer moves to drag (Task.svelte's `.held`). */
	.grid-cell-block-header:global(.held) {
		border-radius: var(--radius-s);
		background: var(--background-modifier-hover);
	}
	/* The block is being dragged. */
	.grid-cell-block-header.dragging-origin {
		opacity: 0.35;
	}
	.grid-cell-block-edit {
		display: flex;
		align-items: baseline;
		gap: 4px;
		min-width: 0;
	}
	.grid-cell-block-input {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0;
		font-size: 12px;
		line-height: 1.4;
		font-family: inherit;
		color: var(--text-normal);
	}

	/* The header's action stack (shown/hidden by the shared .kairos-action-bar
	   rules in styles.css), dressed like a task row's (Task.svelte). */
	.grid-cell-block-actions {
		position: absolute;
		top: 0;
		right: 0;
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--background-primary);
		z-index: 2;
	}
	/* Stack layout: delete takes the corner, as on every action stack; the rest
	   rise above it in DOM order. */
	.grid-cell-block-actions:global(.kairos-action-stack) .grid-cell-block-action-danger {
		order: -1;
	}
	.grid-cell-block-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		box-shadow: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.grid-cell-block-action:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
		box-shadow: none;
	}
	.grid-cell-block-action-danger:hover {
		color: var(--text-error);
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
		padding: 0 4px;
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

	/* Every hover rule repeats the reset: a theme's `button:not(.clickable-icon):hover`
	   (Blue Topaz gives it a shadow) outranks the base rule above and would dress
	   the label as a button. */
	.grid-cell-add:hover {
		color: var(--text-normal);
		box-shadow: none;
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

	/* The Unscheduled group's "+", in the group's top-right corner on its header
	   line. It shows while the pointer is on that group, and stands down while a
	   task's action bar is awake. (A block's "+" is in its header's action
	   stack.) */
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
		box-shadow: none;
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
