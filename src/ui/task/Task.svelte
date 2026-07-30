<script lang="ts">
	// A self-contained task row.
	//
	// It owns everything intrinsic to a task: the checkbox and its status, the
	// editable description, and the (skeleton) association line beneath. What it
	// does NOT own is context — the parent decides whether this row is a plain
	// nested task or a checkable block's header (`checkable`), supplies the
	// accent color, and handles persistence through the callbacks. That split is
	// what lets the same component render inside a timeline block, a grid cell, a
	// backlog list, etc. without knowing about any of them.
	//
	// Persistence is fire-and-forget: each edit calls back to the parent, which
	// writes markdown and triggers a reparse. This component keeps no state that
	// must survive that reparse except the transient "am I editing" flag.

	import { Menu, Notice } from "obsidian";
	import type { Association, Task, TaskStatus } from "../../types";
	import TaskCheckbox from "./TaskCheckbox.svelte";

	interface Props {
		task: Task;
		// Accent color for the checkbox / association pill. Defaults to the theme
		// accent; real project/domain colors arrive in a later checkpoint.
		color?: string;
		// When true this row represents a checkable block's colocated task, so it
		// styles a touch heavier and never shows its own delete (deleting is a
		// block concern). When false it's an ordinary nested task.
		checkable?: boolean;
		// The association to show under the text. `inherited` dims it to signal it
		// came from the block, not the task itself (spec §2.2 display-only rule).
		association?: Association;
		inherited?: boolean;
		onSetStatus: (task: Task, status: TaskStatus) => void;
		onSetText: (task: Task, text: string) => void;
		onDelete: (task: Task) => void;
	}

	let {
		task,
		color = "var(--interactive-accent)",
		checkable = false,
		association,
		inherited = false,
		onSetStatus,
		onSetText,
		onDelete,
	}: Props = $props();

	// ── Status / checkbox ───────────────────────────────────────────
	// Behaviour matches Holos (see TaskCheckbox): click cycles
	// open → half → done → open; long-press cancels.

	const done = $derived(task.status === "x");
	const half = $derived(task.status === "/");
	const cancelled = $derived(task.status === "-");

	// The forward cycle for a click. Cancelled rejoins the cycle at open.
	function nextStatus(status: TaskStatus): TaskStatus {
		switch (status) {
			case " ":
				return "/";
			case "/":
				return "x";
			default: // "x" or "-"
				return " ";
		}
	}

	function cycleStatus() {
		onSetStatus(task, nextStatus(task.status));
	}

	function cancelStatus() {
		onSetStatus(task, "-");
	}

	// ── Inline description editing (single click) ────────────────────

	let editing = $state(false);
	let draft = $state("");
	let inputEl = $state<HTMLInputElement>();

	function beginEdit() {
		if (editing) return;
		draft = task.text;
		editing = true;
		// Focus after the input renders.
		queueMicrotask(() => inputEl?.focus());
	}

	function commitEdit() {
		if (!editing) return;
		editing = false;
		const next = draft.trim();
		if (next.length > 0 && next !== task.text) onSetText(task, next);
	}

	function cancelEdit() {
		editing = false;
	}

	function onInputKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			commitEdit();
		} else if (event.key === "Escape") {
			event.preventDefault();
			cancelEdit();
		}
	}

	// ── Actions (hover bar + context menu) ───────────────────────────

	function notImplemented(what: string) {
		new Notice(`${what}: not yet implemented`);
	}

	function requestAssociation() {
		// Skeleton: no projects/domains exist yet to pick from.
		notImplemented("Association");
	}

	function requestMetadata() {
		notImplemented("Metadata");
	}

	function del() {
		onDelete(task);
	}

	function openContextMenu(event: MouseEvent) {
		event.preventDefault();
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle(association ? "Edit association" : "Add association")
				.setIcon("folder-symlink")
				.onClick(() => requestAssociation()),
		);
		menu.addItem((item) =>
			item
				.setTitle("Add metadata")
				.setIcon("tag")
				.onClick(() => requestMetadata()),
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle(done ? "Mark open" : "Mark done")
				.setIcon("check")
				.onClick(() => onSetStatus(task, done ? " " : "x")),
		);
		menu.addItem((item) =>
			item
				.setTitle("Mark half-done")
				.setIcon("clock")
				.onClick(() => onSetStatus(task, "/")),
		);
		menu.addItem((item) =>
			item
				.setTitle("Mark cancelled")
				.setIcon("x")
				.onClick(() => onSetStatus(task, "-")),
		);

		if (!checkable) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle("Delete")
					.setIcon("trash")
					.onClick(() => del()),
			);
		}

		menu.showAtMouseEvent(event);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="k-task"
	class:checkable
	class:done
	class:half
	class:cancelled
	oncontextmenu={openContextMenu}
>
	<!-- Hover action bar, floating top-right over the row. -->
	<div class="k-task-actions">
		<button
			class="k-task-action"
			title={association ? "Edit association" : "Add association"}
			aria-label="Association"
			onclick={requestAssociation}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
		</button>
		{#if !checkable}
			<button
				class="k-task-action k-task-action-danger"
				title="Delete"
				aria-label="Delete task"
				onclick={del}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
			</button>
		{/if}
	</div>

	<div class="k-task-row">
		<TaskCheckbox status={task.status} onToggle={cycleStatus} onCancel={cancelStatus} />

		{#if editing}
			<input
				class="k-task-input"
				type="text"
				bind:value={draft}
				bind:this={inputEl}
				onkeydown={onInputKeydown}
				onblur={commitEdit}
			/>
		{:else}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<span class="k-task-text" role="textbox" tabindex="0" onclick={beginEdit}>
				{task.text}
			</span>
		{/if}
	</div>

	{#if association}
		<div class="k-task-assoc" class:inherited class:domain={association.kind === "domain"}>
			<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
			<span class="k-task-assoc-label">{association.id}</span>
		</div>
	{/if}
</div>

<style>
	/* Rectangular by design — no rounded corners anywhere in this component. */
	.k-task {
		position: relative;
		padding: 2px 4px;
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.k-task:hover {
		background: var(--background-modifier-hover);
	}

	.k-task.checkable {
		font-weight: 600;
	}

	/* ── Hover action bar ── */
	.k-task-actions {
		position: absolute;
		top: 0;
		right: 0;
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--background-primary);
		/* Semi-transparent so the row underneath reads through for contrast. */
		opacity: 0;
		transition: opacity 0.1s;
		z-index: 2;
	}

	.k-task:hover .k-task-actions {
		opacity: 0.96;
	}

	.k-task-action {
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

	.k-task-action:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.k-task-action-danger:hover {
		color: var(--text-error);
	}

	/* ── Row: checkbox + text ── */
	.k-task-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.k-task-text {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-normal);
		cursor: text;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.k-task.done .k-task-text,
	.k-task.cancelled .k-task-text {
		text-decoration: line-through;
		opacity: 0.5;
	}

	.k-task.half .k-task-text {
		opacity: 0.9;
	}

	/* The edit input is styled to be indistinguishable from the static text:
	   same box, no border, no background, no extra padding. Editing should feel
	   like typing in place, not opening a field. */
	.k-task-input {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		line-height: 1.4;
		font-family: inherit;
		color: var(--text-normal);
		margin: 0;
		padding: 0;
		border: none;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		outline: none;
	}

	.k-task-input:focus,
	.k-task-input:focus-visible {
		border: none;
		box-shadow: none;
		outline: none;
	}

	/* ── Association line (small text + icon under the task) ── */
	.k-task-assoc {
		display: flex;
		align-items: center;
		gap: 3px;
		padding-left: 24px; /* align under the text, past the 18px checkbox + gap */
		font-size: 10px;
		color: var(--text-muted);
		min-width: 0;
	}

	.k-task-assoc.inherited {
		opacity: 0.6;
		font-style: italic;
	}

	.k-task-assoc.domain {
		color: var(--text-accent);
	}

	.k-task-assoc svg {
		flex-shrink: 0;
	}

	.k-task-assoc-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
