<script lang="ts">
	// A block group's header in the routines list, drawn like the Grid's block
	// header (decision 70) so the routines read the same way as every other
	// view: `HH:MM Title`, small and muted, with the block's tasks under it and a
	// "+" at the right end that adds a task to this block. A checkable block is
	// its own row (an inert checkbox, then `HH:MM Title`), as in the Grid; an
	// untimed home is just its title; Unscheduled is italic.
	//
	// Unlike the Grid's header it edits the block it heads, since the list is
	// where routines change: select the time or title to edit it;
	// the corner action bar and the context menu change the rule, association,
	// checkbox, or delete it. Purely presentational: the parent writes.

	import { Menu } from "obsidian";
	import TaskCheckbox from "../task/TaskCheckbox.svelte";
	import { actionZone } from "../actions/actionZone";
	import { tooltip } from "../actions/tooltip";
	import { autogrow, singleLine } from "../actions/autogrow";

	interface Props {
		kind: "block" | "home" | "unscheduled";
		title: string;
		/** "09:00 - 10:00" for a block; edited as that text. */
		timeText?: string;
		/** The start time shown before the title ("09:00"). */
		start?: string;
		checkable?: boolean;
		/** The block's association, shown at the end of the line in its colour. */
		assocLabel?: string;
		assocColor?: string;
		/** Accent for the checkbox and the hover link tint (a domain colour). */
		color?: string;
		paused?: boolean;
		onAdd: () => void;
		onRename?: (title: string) => void;
		onSetTime?: (text: string) => void;
		onChangeRule?: () => void;
		onEditAssoc?: (rect: DOMRect) => void;
		onToggleCheckable?: () => void;
		onDelete?: () => void;
	}

	let {
		kind,
		title,
		timeText,
		start,
		checkable = false,
		assocLabel,
		assocColor,
		color,
		paused = false,
		onAdd,
		onRename,
		onSetTime,
		onChangeRule,
		onEditAssoc,
		onToggleCheckable,
		onDelete,
	}: Props = $props();

	const isBlock = $derived(kind === "block");
	const addLabel = $derived(kind === "unscheduled" ? "Add task" : `Add task to ${title}`);
	let rowEl = $state<HTMLDivElement>();
	let editing = $state<"title" | "time" | null>(null);

	function finish(field: "title" | "time", value: string) {
		if (editing !== field) return;
		editing = null;
		const next = singleLine(value).trim();
		if (field === "title" && next && next !== title) onRename?.(next);
		if (field === "time" && next && next !== timeText) onSetTime?.(next);
	}
	function keys(e: KeyboardEvent & { currentTarget: HTMLInputElement | HTMLTextAreaElement }, original: string) {
		if (e.key === "Enter") {
			e.preventDefault();
			e.currentTarget.blur();
		} else if (e.key === "Escape") {
			e.currentTarget.value = original;
			e.currentTarget.blur();
		}
	}

	function assoc() {
		const rect = rowEl?.getBoundingClientRect();
		if (rect) onEditAssoc?.(rect);
	}

	function openMenu(e: MouseEvent) {
		if (!isBlock) return;
		e.preventDefault();
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(addLabel).setIcon("plus").onClick(() => onAdd()));
		menu.addItem((i) => i.setTitle("Change the time").setIcon("clock").onClick(() => (editing = "time")));
		menu.addItem((i) => i.setTitle("Change when it repeats").setIcon("repeat").onClick(() => onChangeRule?.()));
		menu.addItem((i) =>
			i.setTitle(assocLabel ? "Edit association" : "Add association").setIcon("folder-symlink").onClick(assoc),
		);
		menu.addItem((i) =>
			i
				.setTitle(checkable ? "Make it a plain block" : "Make it checkable")
				.setIcon("square-check")
				.onClick(() => onToggleCheckable?.()),
		);
		menu.addSeparator();
		menu.addItem((i) => i.setTitle("Delete").setIcon("trash").onClick(() => onDelete?.()));
		menu.showAtMouseEvent(e);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="rg-header"
	class:block={isBlock}
	class:checkable={isBlock && checkable}
	class:unscheduled={kind === "unscheduled"}
	class:paused
	bind:this={rowEl}
	oncontextmenu={openMenu}
	use:actionZone={{ layout: "stack" }}
>
	{#if isBlock}
		<div class="rg-actions kairos-action-bar">
			<button class="rg-action" aria-label="Change when it repeats" use:tooltip={"Change when it repeats"} onclick={() => onChangeRule?.()}>
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
			</button>
			<button class="rg-action" aria-label={assocLabel ? "Edit association" : "Add association"} use:tooltip={assocLabel ? "Edit association" : "Add association"} onclick={assoc}>
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
			</button>
			<button class="rg-action" aria-label={checkable ? "Make it a plain block" : "Make it checkable"} use:tooltip={checkable ? "Make it a plain block" : "Make it checkable"} onclick={() => onToggleCheckable?.()}>
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="3"/><path d="m9 12 2 2 4-4"/></svg>
			</button>
			<button class="rg-action rg-action-danger" aria-label="Delete block" use:tooltip={"Delete block"} onclick={() => onDelete?.()}>
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
			</button>
		</div>
	{/if}

	<div class="rg-row">
		{#if isBlock && checkable}
			<span class="rg-check">
				<TaskCheckbox status=" " {color} onToggle={() => {}} onCancel={() => {}} />
			</span>
		{/if}

		{#if isBlock && editing === "time"}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="rg-input rg-time-input kairos-inline-input"
				value={timeText}
				placeholder="HH:MM - HH:MM"
				autofocus
				onfocus={(e) => e.currentTarget.select()}
				onblur={(e) => finish("time", e.currentTarget.value)}
				onkeydown={(e) => keys(e, timeText ?? "")}
			/>
		{:else if isBlock && start}
			<button class="rg-time" title={`${timeText} · select to change`} onclick={() => (editing = "time")}>{start}</button>
		{/if}

		{#if isBlock && editing === "title"}
			<!-- svelte-ignore a11y_autofocus -->
			<textarea
				class="rg-input kairos-inline-input"
				rows="1"
				value={title}
				autofocus
				use:autogrow
				onfocus={(e) => e.currentTarget.select()}
				onblur={(e) => finish("title", e.currentTarget.value)}
				onkeydown={(e) => keys(e, title)}
			></textarea>
		{:else if isBlock}
			<button class="rg-title" onclick={() => (editing = "title")}>{title}</button>
		{:else}
			<span class="rg-title rg-static">{title}</span>
		{/if}

		{#if assocLabel && editing === null}
			<span class="rg-assoc" style:color={assocColor}>{assocLabel}</span>
		{/if}
		{#if paused}
			<span class="rg-paused" use:tooltip={"Paused: its project or domain isn't active. It comes back when that's active again."}>Paused</span>
		{/if}
	</div>

	<!-- The "+" at the right end of the header line, as in the Grid. -->
	<button class="rg-add" aria-label={addLabel} use:tooltip={addLabel} onclick={() => onAdd()}>
		<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
	</button>
</div>

<style>
	.rg-header {
		position: relative;
		padding: 1px 28px 1px 4px;
		border-radius: var(--radius-s);
		min-width: 0;
	}
	.rg-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		/* Start where task text starts (past a task's checkbox), as the Grid's
		   block header does, so times and task text line up down the list. */
		padding-left: var(--kairos-meta-indent);
		/* The Grid's block header type: the task text size, muted. */
		font-size: 12px;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
	/* A checkable block is a task-like row: its checkbox sits in the indent. */
	.rg-header.checkable .rg-row {
		padding-left: 0;
		color: var(--text-normal);
	}
	.rg-check {
		display: flex;
		width: calc(var(--kairos-meta-indent) - 6px);
		flex-shrink: 0;
	}
	.rg-check :global(.k-checkbox) {
		pointer-events: none;
		opacity: 0.55;
	}
	.rg-header.unscheduled .rg-row {
		font-style: italic;
	}

	.rg-time,
	.rg-title {
		height: auto;
		padding: 0;
		border: none;
		background: transparent;
		box-shadow: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: text;
	}
	.rg-time {
		flex-shrink: 0;
	}
	.rg-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rg-static {
		cursor: default;
	}
	.rg-time:hover,
	.rg-title:not(.rg-static):hover {
		color: var(--text-normal);
		background: transparent;
	}
	.rg-input {
		flex: 1;
		min-width: 0;
		font-size: 12px;
	}
	.rg-time-input {
		flex: 0 0 110px;
	}
	.rg-assoc {
		flex-shrink: 1;
		min-width: 0;
		font-size: var(--font-ui-smaller);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rg-paused {
		flex-shrink: 0;
		padding: 0 6px;
		border-radius: 8px;
		font-size: 10px;
		font-style: normal;
		line-height: 16px;
		color: var(--text-muted);
		background: var(--background-modifier-hover);
	}
	.rg-header.paused .rg-time,
	.rg-header.paused .rg-title,
	.rg-header.paused .rg-assoc,
	.rg-header.paused .rg-check {
		opacity: 0.5;
	}

	/* The group's "+", as in the Grid: shown on hover, at the line's end. */
	.rg-add {
		position: absolute;
		top: 1px;
		right: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		border-radius: var(--radius-s);
		color: var(--text-muted);
		background: transparent;
		box-shadow: none;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.1s;
	}
	.rg-header:hover .rg-add,
	.rg-add:focus-visible {
		opacity: 0.75;
	}
	.rg-add:hover {
		opacity: 1;
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}
	.rg-header:global(.kairos-actions-awake) .rg-add {
		opacity: 0;
		pointer-events: none;
	}
	@media (hover: none) {
		.rg-add {
			opacity: 0.5;
		}
	}

	.rg-actions {
		position: absolute;
		top: 50%;
		right: 8px;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border-radius: 4px;
		background: var(--background-primary);
	}
	.rg-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 4px;
		box-shadow: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.rg-action:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	/* Stack layout (styles.css): delete takes the corner cell. */
	.rg-action-danger {
		order: -1;
	}
	.rg-action-danger:hover {
		color: var(--text-error, #e05555);
	}
</style>
