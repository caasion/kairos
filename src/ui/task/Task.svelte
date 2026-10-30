<script lang="ts">
	// A self-contained task row, built on the shared item row (ItemRow, with
	// ItemText for the description).
	//
	// It owns everything intrinsic to a task: the checkbox and its status, the
	// editable description, and the (skeleton) association line beneath. What it
	// does NOT own is context — the parent decides which actions the row offers,
	// supplies the accent color, and handles persistence through the callbacks.
	// That split is what lets the same component render inside a timeline block,
	// a grid cell, a backlog list, etc. without knowing about any of them.
	//
	// Persistence is fire-and-forget: each edit calls back to the parent, which
	// writes markdown and triggers a reparse. This component keeps no state that
	// must survive that reparse except the transient "am I editing" flag.

	import { Menu, Notice } from "obsidian";
	import type { Snippet } from "svelte";
	import type { Association, Task, TaskStatus } from "../../types";
	import type { Highlight } from "../../viewLinks";
	import type { ResolvedAssociation } from "../../association";
	import { tooltip } from "../actions/tooltip";
	import TaskCheckbox from "./TaskCheckbox.svelte";
	import AssocMeta from "../components/AssocMeta.svelte";
	import ItemRow from "../components/ItemRow.svelte";
	import ItemText from "../components/ItemText.svelte";

	interface Props {
		task: Task;
		// Resolved domain color for the checkbox accent. Omit (undefined) to keep
		// the theme accent — do not pass the accent variable itself (see below).
		color?: string;
		// The task's association. Drives the add/edit association action, and is
		// shown under the text unless `showAssociation` is false. `inherited`
		// italicises it to signal it came from the block, not the task itself
		// (spec §2.2 display-only rule).
		association?: Association;
		inherited?: boolean;
		// Draw the association line under the text. The grid turns it off: its
		// rows exist to state the association, so repeating it on every task in
		// the row is noise. The association action stays available either way.
		showAssociation?: boolean;
		// Resolved form of `association` (display name, domain color, target). When
		// present and resolved, the pill shows the canonical name, tints by the
		// domain color, and becomes ctrl-clickable via `onNavigate`.
		resolved?: ResolvedAssociation;
		onNavigate?: () => void;
		// Open the association picker for this task, anchored at `rect`.
		onEditAssoc?: (rect: DOMRect) => void;
		// Open the block picker to nest this task under another block, anchored at
		// `rect`. Omitted where the view offers no nesting.
		onNest?: (rect: DOMRect) => void;
		// Menu/tooltip label for the nest action. Callers where the task already has
		// a parent block (e.g. the grid's scheduled tasks) pass "Change parent
		// block"; the default fits a task being nested for the first time.
		nestLabel?: string;
		// Move this task off its day and back into the backlog (spec §2.6). The
		// parent lifts the task's text + materialized association into a fresh
		// backlog entry and drops the day task. Omitted where there is no backlog
		// to move it to (the backlog view itself).
		onMoveToBacklog?: () => void;
		// Turn this task into a routine ("Repeat…"): opens the rule picker and adds
		// a routine built from the task. The task itself stays as the first one.
		onRepeat?: () => void;
		// Extra metadata rendered inside the row, beneath the text on the same line
		// as the association (so it shares the row's hover region). The grid uses
		// this for the block-nesting badge. Snippet content is compiled in the
		// component that defines it, so this component's styles never reach it —
		// the caller uses the global `.kairos-meta` family to match.
		meta?: Snippet;
		// A long-press on the task body (never the checkbox) began a drag-to-nest.
		// The parent takes over from here. Omitted where dragging isn't supported
		// — then the body is just static.
		onGrab?: (event: PointerEvent) => void;
		// How many lines the text may wrap to before it's clamped with an
		// ellipsis. 1 (the default) keeps the compact single-line row; roomier
		// views like the grid pass 2.
		lines?: number;
		// Hover link (viewLinks.ts): "block" when the block this task sits in is
		// under the pointer somewhere, "task" when this task is. `onHoverChange`
		// reports the pointer entering (true) or leaving (false) this row.
		highlight?: Highlight;
		onHoverChange?: (hovering: boolean) => void;
		// A short muted label after the text on the task's own line (the Grid's
		// rolled-up project chip). It gives way first when the line is tight, so
		// the task text keeps its room.
		trailing?: string;
		// A routine template (the Routines view), not a task in a day: it looks
		// like every other task, but its checkbox is inert and it has no status
		// to set, since a template is never done.
		template?: boolean;
		// Menu/tooltip label for `onRepeat` ("Change when it repeats" on a routine).
		repeatLabel?: string;
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
		association,
		inherited = false,
		showAssociation = true,
		resolved,
		onNavigate,
		onEditAssoc,
		onNest,
		nestLabel = "Nest under block",
		onMoveToBacklog,
		onRepeat,
		meta,
		onGrab,
		lines = 1,
		highlight = null,
		onHoverChange,
		trailing,
		template = false,
		repeatLabel = "Repeat…",
		onSetStatus,
		onSetText,
		onDelete,
	}: Props = $props();

	// Label prefers the resolved canonical name (never an alias); falls back to
	// the raw tag id when no resolution was supplied or it didn't resolve.
	const assocLabel = $derived(resolved?.displayName ?? association?.id ?? "");
	// The association button's tooltip and accessible name.
	const assocAction = $derived(association ? "Edit association" : "Add association");
	// An inherited association gets no line of its own — the block
	// above already shows it, so repeating it on every task only costs height.
	const showAssocLine = $derived(!!association && showAssociation && !inherited);

	// ── Hover link ──────────────────────────────────────────────────
	// Reported on enter/leave. A row removed while the pointer is on it gets no
	// leave event, so it reports leaving on teardown — otherwise its stale
	// path/line would keep glowing on whatever lands on that line next.
	let hovering = false;
	function setHovering(on: boolean) {
		hovering = on;
		onHoverChange?.(on);
	}
	$effect(() => () => {
		if (hovering) onHoverChange?.(false);
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

	// ── Inline description editing (single click, in ItemText) ──

	function commitText(text: string) {
		const next = text.trim();
		if (next.length > 0 && next !== task.text) onSetText(task, next);
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

	// Ask the parent to open the block picker anchored at this row, to nest the
	// task under another block. Only wired for genuine nested tasks.
	function requestNest() {
		const rect = rowEl?.getBoundingClientRect();
		if (rect && onNest) onNest(rect);
	}

	function del() {
		onDelete(task);
	}

	// Drag-to-nest is a hold on the text (ItemText's `onGrab`), never the
	// checkbox, so a hold on the checkbox still cancels the status and a plain
	// click on the text still edits.

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

		if (onRepeat) {
			menu.addItem((item) =>
				item
					.setTitle(repeatLabel)
					.setIcon("repeat")
					.onClick(() => onRepeat()),
			);
		}

		if (!template) {
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
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => del()),
		);

		menu.showAtMouseEvent(event);
	}
</script>

{#snippet checkbox()}
	<TaskCheckbox
		status={task.status}
		{color}
		inert={template}
		onToggle={cycleStatus}
		onCancel={cancelStatus}
	/>
{/snippet}

{#snippet metaLine()}
	<!-- Association and any extra metadata (e.g. the grid's block-nesting badge)
	     share one line: association first, then the metadata. -->
	{#if showAssocLine && association}
		<AssocMeta
			{association}
			label={assocLabel}
			{inherited}
			linked={resolved?.resolved}
			{onNavigate}
		/>
	{/if}
	{@render meta?.()}
{/snippet}

{#snippet actionBar()}
	<!-- Action bar. Shown only while the pointer is in a triangle at the row's
	     top-right corner (see actions/actionZone.ts), not on any hover. On a
	     mouse wake it is a vertical stack one button wide (`layout: "stack"`):
	     delete stays in the row's top-right corner and the other actions rise
	     above it, most used nearest: association, then nest, then repeat. It
	     hangs below instead when there's no room above. Touch keeps the horizontal bar.
	     DOM (= tab) order is unchanged; CSS `order` sets the visual order.
	     Tooltips open to the left of the stack (actions/tooltip.ts). -->
	<div class="k-task-actions kairos-action-bar">
		<button
			class="k-task-action"
			aria-label={assocAction}
			use:tooltip={assocAction}
			onclick={requestAssociation}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
		</button>
		{#if onNest}
			<button
				class="k-task-action"
				aria-label={nestLabel}
				use:tooltip={nestLabel}
				onclick={requestNest}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 12H9"/><path d="m9 12 3-3"/><path d="m9 12 3 3"/></svg>
			</button>
		{/if}
		{#if onRepeat}
			<button
				class="k-task-action"
				aria-label={repeatLabel}
				use:tooltip={repeatLabel}
				onclick={() => onRepeat()}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
			</button>
		{/if}
		<button
			class="k-task-action k-task-action-danger"
			aria-label="Delete task"
			use:tooltip={"Delete task"}
			onclick={del}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
		</button>
	</div>
{/snippet}

<!-- The checkbox is its own element, so its press and long-press (cycle /
     cancel) never reach the text's click-to-edit and hold-to-drag. -->
<ItemRow
	class="k-task"
	square
	wraps={lines > 1}
	lit={highlight}
	{color}
	{trailing}
	zone={{ layout: "stack" }}
	bind:el={rowEl}
	oncontextmenu={openContextMenu}
	onpointerenter={() => setHovering(true)}
	onpointerleave={() => setHovering(false)}
	lead={checkbox}
	actions={actionBar}
	meta={showAssocLine || meta ? metaLine : undefined}
>
	<ItemText
		text={task.text}
		sourcePath={task.source.path}
		{lines}
		mark={done || cancelled ? "struck" : half ? "half" : undefined}
		onCommit={commitText}
		{onGrab}
	/>
</ItemRow>

<style>
	/* The row, its text and its tints are ItemRow's and ItemText's. What's
	   left is the corner action bar. */

	/* ── Hover action bar ── */
	.k-task-actions {
		position: absolute;
		top: 0;
		right: 0;
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--background-primary);
		z-index: 2;
		/* Shown/hidden by the shared .kairos-action-bar rules in styles.css. */
	}

	/* Stack layout (styles.css): the first item by `order` sits in the corner:
	   delete, then association and nest in DOM order. */
	.k-task-actions:global(.kairos-action-stack) .k-task-action-danger {
		order: -1;
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
</style>
