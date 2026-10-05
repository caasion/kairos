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
	import type { Snippet } from "svelte";
	import { autogrow, singleLine } from "../actions/autogrow";
	import type { Association, Task, TaskStatus } from "../../types";
	import type { ResolvedAssociation } from "../../association";
	import TaskCheckbox from "./TaskCheckbox.svelte";
	import { longpress } from "../actions/longpress";
	import { movedPastSlop, peek, peekIfTruncated } from "../actions/peek";

	interface Props {
		task: Task;
		// Resolved domain color for the checkbox accent. Omit (undefined) to keep
		// the theme accent — do not pass the accent variable itself (see below).
		color?: string;
		// When true this row represents a checkable block's colocated task, so it
		// styles a touch heavier and never shows its own delete (deleting is a
		// block concern). When false it's an ordinary nested task.
		checkable?: boolean;
		// The association to show under the text. `inherited` signals it came from
		// the block, not the task itself (spec §2.2 display-only rule) — as italics
		// normally, and as a fainter colour when `hideAssociationLabel` leaves no
		// text to italicise.
		association?: Association;
		inherited?: boolean;
		// Hide the association's *name*, keeping the element itself: its icon, its
		// inherited treatment, its ctrl+click navigation and its tooltip. For the
		// grid, where the row already names the association and the label only
		// repeats it. The icon stays because it is the sole carrier of the
		// inherited/explicit signal once the text is gone — and the only path from
		// a grid cell to the project note.
		hideAssociationLabel?: boolean;
		// Resolved form of `association` (display name, domain color, target). When
		// present and resolved, the pill shows the canonical name, tints by the
		// domain color, and becomes ctrl-clickable via `onNavigate`.
		resolved?: ResolvedAssociation;
		onNavigate?: () => void;
		// Open the association picker for this task, anchored at `rect`.
		onEditAssoc?: (rect: DOMRect) => void;
		// Open the block picker to nest this task under another block, anchored at
		// `rect`. Omitted for a colocated (checkable-block) task, which can't be
		// lifted off its line — the parent leaves it undefined there.
		onNest?: (rect: DOMRect) => void;
		// Menu/tooltip label for the nest action. Callers where the task already has
		// a parent block (e.g. the grid's scheduled tasks) pass "Change parent
		// block"; the default fits a task being nested for the first time.
		nestLabel?: string;
		// Move this task off its day and back into the backlog (spec §2.6). The
		// parent lifts the task's text + materialized association into a fresh
		// backlog entry and drops the day task. Omitted where the task can't leave
		// its line (a colocated/checkable-block task) or where there is no backlog
		// to move it to (the backlog view itself).
		onMoveToBacklog?: () => void;
		// Extra metadata rendered inside the row, beneath the text on the same line
		// as the association (so it shares the row's hover region). The grid uses
		// this for the block-nesting badge. Snippet content is compiled in the
		// component that defines it, so this component's styles never reach it —
		// the caller uses the global `.kairos-meta` family to match.
		meta?: Snippet;
		// A long-press on the task body (never the checkbox) began a drag-to-nest.
		// The parent takes over from here. Omitted where dragging isn't supported
		// (e.g. a colocated task, or the grid) — then the body is just static.
		onGrab?: (event: PointerEvent) => void;
		// How many lines the text may wrap to before it's clamped with an
		// ellipsis. 1 (the default) keeps the compact single-line row; roomier
		// views like the grid pass 2.
		lines?: number;
		onSetStatus: (task: Task, status: TaskStatus) => void;
		onSetText: (task: Task, text: string) => void;
		onDelete: (task: Task) => void;
	}

	let {
		task,
		// A resolved domain color, or undefined to keep the theme accent. Passing
		// the accent variable here would make TaskCheckbox emit a self-referential
		// `--interactive-accent: var(--interactive-accent)` (→ black), so leave it
		// undefined and let the checkbox fall through to the theme.
		color,
		checkable = false,
		association,
		inherited = false,
		hideAssociationLabel = false,
		resolved,
		onNavigate,
		onEditAssoc,
		onNest,
		nestLabel = "Nest under block",
		onMoveToBacklog,
		meta,
		onGrab,
		lines = 1,
		onSetStatus,
		onSetText,
		onDelete,
	}: Props = $props();

	// Label prefers the resolved canonical name (never an alias); falls back to
	// the raw tag id when no resolution was supplied or it didn't resolve.
	const assocLabel = $derived(resolved?.displayName ?? association?.id ?? "");

	// With the label hidden the icon is the whole line, so the tooltip has to
	// carry what the text used to: the name, and whether it was inherited from
	// the parent block or set on this task.
	const assocTitle = $derived.by(() => {
		if (!hideAssociationLabel) return resolved?.resolved ? "Ctrl+click to open" : undefined;
		const origin = inherited ? `${assocLabel} — inherited from this block` : assocLabel;
		return resolved?.resolved ? `${origin} — ctrl+click to open` : origin;
	});

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
	let inputEl = $state<HTMLInputElement | HTMLTextAreaElement>();

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
		const next = singleLine(draft).trim();
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

	let rowEl = $state<HTMLDivElement>();

	// Open the association picker anchored at this task row. The parent (which
	// owns the picker) decides what a pick does.
	function requestAssociation() {
		const rect = rowEl?.getBoundingClientRect();
		if (rect && onEditAssoc) onEditAssoc(rect);
		else notImplemented("Association");
	}

	function requestMetadata() {
		notImplemented("Metadata");
	}

	// Ask the parent to open the block picker anchored at this row, to nest the
	// task under another block. Only wired for genuine nested tasks.
	function requestNest() {
		const rect = rowEl?.getBoundingClientRect();
		if (rect && onNest) onNest(rect);
	}

	function del() {
		onDelete(task);
	}

	// ── Drag-to-nest (long-press the body) ───────────────────────────
	// The long-press action fires a bare CustomEvent, so we stash the pointerdown
	// that started the press and hand it to the parent when the press matures.
	// The press is armed only on the text body — never the checkbox — so a hold
	// on the checkbox still cancels the status (see TaskCheckbox), and a plain
	// click on the body still edits.
	let pressEvent: PointerEvent | undefined;
	let textEl = $state<HTMLSpanElement>();
	// True between the press maturing and the pointer either moving (→ drag) or
	// lifting (→ peek at the full text).
	let held = $state(false);

	function armGrab(event: PointerEvent) {
		if (event.button !== 0) return; // primary button only
		pressEvent = event;
	}

	// The longpress action dispatches a bare `longpress` CustomEvent; listen for
	// it directly (as TaskCheckbox does) rather than via an `on<name>` attribute,
	// which Svelte's typed DOM attributes don't cover for custom events.
	//
	// A matured hold doesn't lift the task straight away: it waits to see what
	// the pointer does next. Moving past the slop hands the drag to the parent;
	// lifting in place opens the full-text peek instead (the touch equivalent of
	// hovering a truncated task). Releasing in place therefore never drops the
	// task back onto its own block, which used to rewrite the note.
	$effect(() => {
		const el = textEl;
		if (!el) return;
		let cleanup: (() => void) | undefined;

		const finish = () => {
			held = false;
			pressEvent = undefined;
			cleanup?.();
			cleanup = undefined;
		};

		const onLongpress = () => {
			const start = pressEvent;
			if (!start) return;
			held = true;
			const move = (e: PointerEvent) => {
				if (e.pointerId !== start.pointerId || !movedPastSlop(start, e)) return;
				finish();
				onGrab?.(e);
			};
			const up = (e: PointerEvent) => {
				if (e.pointerId !== start.pointerId) return;
				finish();
				peekIfTruncated(el, { text: task.text });
			};
			const cancel = () => finish();
			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", up);
			window.addEventListener("pointercancel", cancel);
			cleanup = () => {
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", up);
				window.removeEventListener("pointercancel", cancel);
			};
		};

		el.addEventListener("longpress", onLongpress);
		return () => {
			el.removeEventListener("longpress", onLongpress);
			finish();
		};
	});

	function openContextMenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
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

		if (onNest) {
			menu.addItem((item) =>
				item
					.setTitle(nestLabel)
					.setIcon("between-vertical-start")
					.onClick(() => requestNest()),
			);
		}

		if (onMoveToBacklog) {
			menu.addItem((item) =>
				item
					.setTitle("Move to backlog")
					.setIcon("inbox")
					.onClick(() => onMoveToBacklog()),
			);
		}

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
	bind:this={rowEl}
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
		{#if onNest}
			<button
				class="k-task-action"
				title={nestLabel}
				aria-label={nestLabel}
				onclick={requestNest}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 12H9"/><path d="m9 12 3-3"/><path d="m9 12 3 3"/></svg>
			</button>
		{/if}
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

	<div class="k-task-row" class:wrapped={lines > 1}>
		<TaskCheckbox status={task.status} {color} onToggle={cycleStatus} onCancel={cancelStatus} />

		{#if editing && lines > 1}
			<!-- Wrapped text edits in a growing textarea so it wraps exactly as the
			     label did; Enter still commits (onInputKeydown), so it stays one line
			     of markdown. -->
			<textarea
				class="k-task-input kairos-inline-input"
				rows="1"
				bind:value={draft}
				bind:this={inputEl}
				onkeydown={onInputKeydown}
				onblur={commitEdit}
				use:autogrow
			></textarea>
		{:else if editing}
			<input
				class="k-task-input kairos-inline-input"
				type="text"
				bind:value={draft}
				bind:this={inputEl}
				onkeydown={onInputKeydown}
				onblur={commitEdit}
			/>
		{:else}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- Hover (mouse) or hold-and-release (touch) shows the full text when it's
			     truncated; hold-and-move grabs the task to drag it between blocks; a
			     plain click still edits. The checkbox is a separate element, so its own
			     press/long-press (status cycle / cancel) is untouched. -->
			<span
				class="k-task-text"
				class:grabbable={onGrab !== undefined}
				class:held
				role="textbox"
				tabindex="0"
				bind:this={textEl}
				class:wrapped={lines > 1}
				style:--k-task-lines={lines > 1 ? lines : undefined}
				onclick={beginEdit}
				onpointerdown={armGrab}
				use:longpress={400}
				use:peek={{ text: task.text, touch: false }}
			>
				{task.text}
			</span>
		{/if}
	</div>

	{#if association || meta}
		<!-- Association and any extra metadata (e.g. the grid's block-nesting badge)
		     share one inline row: association first, then the metadata. Both align
		     under the task text, past the checkbox. -->
		<div class="kairos-meta-row is-indented">
			{#if association}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="kairos-meta"
					class:is-icon-only={hideAssociationLabel}
					class:is-inherited={inherited}
					class:is-linked={resolved?.resolved}
					title={assocTitle}
					onclick={(e) => {
						if ((e.ctrlKey || e.metaKey) && onNavigate) {
							e.stopPropagation();
							onNavigate();
						}
					}}
				>
					{#if association.kind === "domain"}
						<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
					{/if}
					{#if !hideAssociationLabel}
						<span class="kairos-meta-label">{assocLabel}</span>
					{/if}
				</div>
			{/if}

			<!-- Extra metadata (e.g. the grid's block-nesting badge). -->
			{@render meta?.()}
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
		box-shadow: none;
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
		/* No text selection so a long-press-to-drag doesn't paint a selection. */
		user-select: none;
		touch-action: none;
	}

	/* Multi-line: wrap, then clamp at `lines` with a trailing ellipsis. */
	.k-task-text.wrapped {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: var(--k-task-lines);
		line-clamp: var(--k-task-lines);
		white-space: normal;
		overflow-wrap: anywhere;
	}

	/* Keep the checkbox on the first line when the text wraps. */
	.k-task-row.wrapped {
		align-items: flex-start;
	}

	.k-task-text.grabbable {
		cursor: grab;
	}

	/* A matured hold: tint the text so the press reads as registered before the
	   pointer decides between drag (move) and peek (lift). */
	.k-task-text.held {
		border-radius: var(--radius-s);
		background: var(--background-modifier-hover);
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

	/* The meta line under the task text (association + whatever the parent adds)
	   is styled by the shared `.kairos-meta` family in styles.css, so the grid's
	   badge, the timeline's time+association line and this one stay one system.
	   Nothing about it is local to this component. */
</style>
