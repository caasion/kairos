<script lang="ts">
  import type {
    Association,
    Block,
    ResolvedTask,
    Task,
    TaskStatus,
    TimeRange,
  } from "../../types";
  import { isCheckable } from "../../types";
  import type { Resolver } from "../../index";
  import { Menu } from "obsidian";
  import TaskComponent from "../task/Task.svelte";
  import TaskCheckbox from "../task/TaskCheckbox.svelte";

  interface Props {
    block: Block;
    tasks: ResolvedTask[];
    top: number;
    height: number;
    column: number;
    lanes: number;
    selected?: boolean;
    dragging?: boolean;
    // Resolves an association to its display name, domain color, and target;
    // `onNavigate` opens that target on ctrl-click. Both come from DayView.
    resolve: Resolver;
    onNavigate: (assoc: Association) => void;
    // Emitted when a pointer press starts a gesture on this block. The parent
    // (DayView) owns the canvas-level pointer tracking and decides what the
    // gesture becomes; this component only reports where it began.
    onGestureStart: (
      mode: "move" | "resize-top" | "resize-bottom",
      block: Block,
      event: PointerEvent,
    ) => void;
		onDelete: (block: Block) => void;
		// Task write-back, forwarded to DayView which persists via the writer. The
		// owning block travels with each call so the writer can locate the task.
		onSetTaskStatus: (owner: Block, task: Task, status: TaskStatus) => void;
		onSetTaskText: (owner: Block, task: Task, text: string) => void;
		onDeleteTask: (owner: Block, task: Task) => void;
		// Open the association picker for a nested task, anchored at `rect`.
		onEditTaskAssoc: (owner: Block, task: Task, rect: DOMRect) => void;
		// Block field write-back.
		onSetBlockTitle: (block: Block, title: string) => void;
		onSetBlockTime: (block: Block, time: TimeRange) => void;
		onSetBlockStatus: (block: Block, status: TaskStatus) => void;
		// Toggle whether the block is a checkable task (adds/removes its checkbox).
		onToggleCheckable: (block: Block) => void;
		// Create a new child task inside this block.
		onAddTask: (block: Block) => void;
		// Open the association picker for this block, anchored at `rect`.
		onEditAssoc: (block: Block, rect: DOMRect) => void;
  }

  let {
    block,
    tasks,
    top,
    height,
    column,
    lanes,
    selected = false,
    dragging = false,
    resolve,
    onNavigate,
    onGestureStart,
		onDelete,
		onSetTaskStatus,
		onSetTaskText,
		onDeleteTask,
		onEditTaskAssoc,
		onSetBlockTitle,
		onSetBlockTime,
		onSetBlockStatus,
		onToggleCheckable,
		onAddTask,
		onEditAssoc,
  }: Props = $props();

  function fmt(minutes: number): string {
    const hh = Math.floor(minutes / 60);
    const mm = minutes % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  const timeLabel = $derived(
    block.time ? `${fmt(block.time.start)}–${fmt(block.time.end)}` : "",
  );

  const checkable = $derived(isCheckable(block));
  const blockChecked = $derived(block.status === "x");

  // Domain color for the block's accent — the left border and the colocated
  // checkbox. Undefined when the association is a project with no domain, or
  // unresolved; the accent then falls back to the theme. The association *tag*
  // stays plain; only the accent carries the color.
  const accentColor = $derived(
    block.assoc ? resolve(block.assoc).color : undefined,
  );

  // The colocated task is represented by the block header itself, so it is not
  // repeated in the chip list.
  const chips = $derived(tasks.filter((t) => !t.colocated));

  // Horizontal lane geometry: equal-width columns within the block's cluster.
  // Blocks occupy a left band (BAND%) of the row, leaving a gutter on the right
  // so you can press empty canvas beside a block to create another there
  // (spec CP2: blocks take ~90–95% of the timeline width).
  const BAND = 92;
  const widthPct = $derived(BAND / lanes);
  const leftPct = $derived(column * widthPct);

  // A short block can't show its task chips; collapse to a compact look.
  const compact = $derived(height < 44);

  function start(
    mode: "move" | "resize-top" | "resize-bottom",
    event: PointerEvent,
  ) {
    // Only the primary button drives gestures; ignore right/middle clicks.
    if (event.button !== 0) return;
    onGestureStart?.(mode, block, event);
  }

  // ── Title editing (single click, in place) ──────────────────────

  let editingTitle = $state(false);
  let titleDraft = $state("");
  let titleInputEl = $state<HTMLInputElement>();

  function beginTitleEdit() {
    if (editingTitle) return;
    titleDraft = block.title;
    editingTitle = true;
    queueMicrotask(() => titleInputEl?.focus());
  }

  function commitTitleEdit() {
    if (!editingTitle) return;
    editingTitle = false;
    const next = titleDraft.trim();
    if (next.length > 0 && next !== block.title) onSetBlockTitle(block, next);
  }

  function onTitleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTitleEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editingTitle = false;
    }
  }

  // ── Time editing (native time inputs; reject end ≤ start) ────────

  let editingTime = $state(false);
  let startDraft = $state(""); // "HH:MM"
  let endDraft = $state("");

  function beginTimeEdit() {
    if (!block.time || editingTime) return;
    startDraft = fmt(block.time.start);
    endDraft = fmt(block.time.end);
    editingTime = true;
  }

  // Parse an "HH:MM" value from a native time input to minutes-since-midnight.
  function parseHHMM(value: string): number | undefined {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!m) return undefined;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
    return hh * 60 + mm;
  }

  function commitTimeEdit() {
    if (!editingTime) return;
    const start = parseHHMM(startDraft);
    const end = parseHHMM(endDraft);
    // Only persist a valid range; a block can't have zero/negative minutes
    // (spec §2.1). An invalid entry just closes the editor unchanged.
    if (start !== undefined && end !== undefined && end > start) {
      if (!block.time || start !== block.time.start || end !== block.time.end) {
        onSetBlockTime(block, { start, end });
      }
    }
    editingTime = false;
  }

  function onTimeKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTimeEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editingTime = false;
    }
  }

  // ── Block checkbox (checkable block) ─────────────────────────────

  function nextStatus(status: TaskStatus): TaskStatus {
    switch (status) {
      case " ":
        return "/";
      case "/":
        return "x";
      default:
        return " ";
    }
  }

  function cycleBlockStatus() {
    if (block.status === undefined) return;
    onSetBlockStatus(block, nextStatus(block.status));
  }

  function cancelBlockStatus() {
    if (block.status === undefined) return;
    onSetBlockStatus(block, "-");
  }

  // ── Block context menu ───────────────────────────────────────────

  let blockEl = $state<HTMLDivElement>();
  let metaEl = $state<HTMLDivElement>();

  // Open the picker anchored under the meta (time · association) line, so it
  // drops right below that line — even if it overlaps the tasks beneath.
  function requestEditAssoc() {
    const rect = metaEl?.getBoundingClientRect() ?? blockEl?.getBoundingClientRect();
    if (rect) onEditAssoc(block, rect);
  }

  function openContextMenu(event: MouseEvent) {
    event.preventDefault();
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle("Add task")
        .setIcon("list-plus")
        .onClick(() => onAddTask(block)),
    );

    menu.addItem((item) =>
      item
        .setTitle(block.assoc ? "Edit association" : "Add association")
        .setIcon("folder-symlink")
        .onClick(() => requestEditAssoc()),
    );

    menu.addSeparator();

    // Convert the block to/from a checkable task. When it's already checkable,
    // offer the same status changes a task's context menu does.
    menu.addItem((item) =>
      item
        .setTitle(checkable ? "Convert to block" : "Convert to task")
        .setIcon(checkable ? "square" : "check-square")
        .onClick(() => onToggleCheckable(block)),
    );

    if (checkable) {
      menu.addItem((item) =>
        item
          .setTitle(blockChecked ? "Mark open" : "Mark done")
          .setIcon("check")
          .onClick(() => onSetBlockStatus(block, blockChecked ? " " : "x")),
      );
      menu.addItem((item) =>
        item
          .setTitle("Mark half-done")
          .setIcon("clock")
          .onClick(() => onSetBlockStatus(block, "/")),
      );
      menu.addItem((item) =>
        item
          .setTitle("Mark cancelled")
          .setIcon("x")
          .onClick(() => onSetBlockStatus(block, "-")),
      );
    }

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Delete block")
        .setIcon("trash")
        .onClick(() => onDelete(block)),
    );

    menu.showAtMouseEvent(event);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tl-block"
  class:selected
  class:dragging
  data-block-line={block.source.line}
  bind:this={blockEl}
  style={`top: ${top}px; height: ${height}px; left: calc(${leftPct}% + 2px); width: calc(${widthPct}% - 4px);`}
  onpointerdown={(e) => start("move", e)}
  oncontextmenu={openContextMenu}
>
  <!-- Resize edges. Placed directly at the outer edge of tl-block -->
  <div
    class="tl-resize tl-resize-top"
    onpointerdown={(e) => {
      e.stopPropagation();
      start("resize-top", e);
    }}
  ></div>

	<!-- Hover action bar: add-task + delete, top-right corner. -->
	<div class="tl-actions">
		<button
			type="button"
			class="tl-action-btn"
			title="Add task"
			aria-label="Add task"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={(e) => {
				e.stopPropagation();
				onAddTask(block);
			}}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/></svg>
		</button>
		<button
			type="button"
			class="tl-action-btn tl-action-danger"
			title="Delete block"
			aria-label="Delete block"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={(e) => {
				e.stopPropagation();
				onDelete(block);
			}}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
		</button>
	</div>

  <!-- Inner visual container -->
  <div
    class="tl-content"
    class:compact
    class:checked={blockChecked}
    style={accentColor ? `border-left-color:${accentColor};` : ""}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tl-block-header">
      {#if checkable}
        <!-- The colocated task's checkbox. Stop pointerdown so pressing it
             doesn't also start a block move. -->
        <span class="tl-check-wrap" onpointerdown={(e) => e.stopPropagation()}>
          <TaskCheckbox
            status={block.status ?? " "}
            color={accentColor}
            onToggle={cycleBlockStatus}
            onCancel={cancelBlockStatus}
          />
        </span>
      {/if}
      {#if editingTitle}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <input
          class="tl-title-input"
          type="text"
          bind:value={titleDraft}
          bind:this={titleInputEl}
          onpointerdown={(e) => e.stopPropagation()}
          onkeydown={onTitleKeydown}
          onblur={commitTitleEdit}
        />
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <span
          class="tl-title"
          role="textbox"
          tabindex="0"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={beginTitleEdit}
        >{block.title}</span>
      {/if}
    </div>

    {#if !compact}
      {#if editingTime}
        <!-- Commit on focusout only when focus leaves the whole editor, so
             tabbing between the two inputs doesn't close it early. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tl-time-edit"
          onpointerdown={(e) => e.stopPropagation()}
          onfocusout={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) commitTimeEdit();
          }}
        >
          <input
            class="tl-time-input"
            type="time"
            bind:value={startDraft}
            onkeydown={onTimeKeydown}
          />
          <span class="tl-time-dash">–</span>
          <input
            class="tl-time-input"
            type="time"
            bind:value={endDraft}
            onkeydown={onTimeKeydown}
          />
        </div>
      {:else}
        <!-- Time and the association share one line, separated by a dot. -->
        <div class="tl-meta" bind:this={metaEl}>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <span
            class="tl-time"
            role="button"
            tabindex="0"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={beginTimeEdit}
          >{timeLabel}</span>
          {#if block.assoc}
            {@const r = resolve(block.assoc)}
            <!-- An SVG dot separator: fixed-size so it can't affect line-height
                 or row height the way a text glyph would. -->
            <svg
              class="tl-meta-dot"
              width="3"
              height="3"
              viewBox="0 0 3 3"
              aria-hidden="true"
            ><circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" /></svg>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="tl-assoc"
              class:domain={block.assoc.kind === "domain"}
              class:linked={r.resolved}
              title={r.resolved ? "Ctrl+click to open" : undefined}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  e.stopPropagation();
                  onNavigate(block.assoc!);
                }
              }}
            >
              {#if block.assoc.kind === "domain"}
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
              {/if}
              <span class="tl-assoc-label">{r.displayName}</span>
            </span>
          {/if}
        </div>
      {/if}
      {#if chips.length > 0}
        <!-- Editable tasks. A press here must not start a block move/resize, so
             the container swallows pointerdown before it reaches the block. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="tl-tasks" onpointerdown={(e) => e.stopPropagation()}>
          {#each chips as task (task.source.line)}
            {@const tr = task.owner ? resolve(task.owner) : undefined}
            <TaskComponent
              {task}
              association={task.owner}
              inherited={task.assoc === undefined}
              resolved={tr}
              color={tr?.color}
              onNavigate={() => task.owner && onNavigate(task.owner)}
              onEditAssoc={(rect) => onEditTaskAssoc(block, task, rect)}
              onSetStatus={(t, status) => onSetTaskStatus(block, t, status)}
              onSetText={(t, text) => onSetTaskText(block, t, text)}
              onDelete={(t) => onDeleteTask(block, t)}
            />
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <div
    class="tl-resize tl-resize-bottom"
    onpointerdown={(e) => {
      e.stopPropagation();
      start("resize-bottom", e);
    }}
  ></div>
</div>

<style>
  .tl-block {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 0;
    cursor: grab;
    user-select: none;
  }

  .tl-block.dragging {
    cursor: grabbing;
    z-index: 4;
  }

  .tl-block.selected {
    z-index: 3;
  }

  .tl-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 6px;
    border: 1px solid var(--background-modifier-border);
    border-left: 3px solid var(--interactive-accent);
    border-radius: 5px;
    background: var(--background-secondary);
    overflow: hidden;
    transition: filter 0.12s;
    min-height: 0;
  }

  .tl-block:hover .tl-content {
    filter: brightness(1.08);
    z-index: 2;
  }

  .tl-block.dragging .tl-content {
    box-shadow: var(--shadow-s);
    filter: brightness(1.1);
  }

  .tl-block.selected .tl-content {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--interactive-accent);
  }

  .tl-content.checked {
    opacity: 0.6;
  }

  .tl-content.compact {
    flex-direction: row;
    align-items: center;
    padding: 2px 6px;
  }

  /* ── Resize edges ── */
  .tl-resize {
    position: absolute;
    left: 0;
    right: 0;
    height: 9px;
    cursor: ns-resize;
    z-index: 6;
    touch-action: none;
  }

  .tl-resize-top {
    top: 0;
  }

  .tl-resize-bottom {
    bottom: 0;
  }

  /* A faint grab affordance on the edge when hovering the block. */
  .tl-block:hover .tl-resize::after {
    content: "";
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 24px;
    height: 3px;
    border-radius: 2px;
    background: var(--interactive-accent);
    opacity: 0.5;
  }

  .tl-resize-top::after {
    top: 2px;
  }

  .tl-resize-bottom::after {
    bottom: 2px;
  }

	/* Hover action bar (add-task + delete), top-right corner. */
	.tl-actions {
		position: absolute;
		top: 4px;
		right: 4px;
		z-index: 10; /* Above content and resize handles. */

		display: flex;
		gap: 2px;
		background: var(--background-secondary);

		/* Revealed on block hover. */
		opacity: 0;
		pointer-events: none; /* Avoid clicks landing while invisible. */
		transition: opacity 0.1s;
	}

	.tl-block:hover .tl-actions {
		opacity: 1;
		pointer-events: auto;
	}

	.tl-action-btn {
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

	.tl-action-btn:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.tl-action-danger:hover {
		color: var(--text-error);
	}

	/* Pin the action-bar icons so a theme's svg reset can't collapse them. */
	.tl-action-btn svg {
		width: 13px;
		height: 13px;
		flex-shrink: 0;
	}

/* Block contents */
  .tl-block-header {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .tl-check-wrap {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .tl-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text;
  }

  .checked .tl-title {
    text-decoration: line-through;
  }

  /* Title edit input: indistinguishable from the static title. */
  .tl-title-input {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    line-height: inherit;
    color: var(--text-normal);
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    outline: none;
  }

  .tl-title-input:focus,
  .tl-title-input:focus-visible {
    border: none;
    box-shadow: none;
    outline: none;
  }

  /* Time + association on one row, dot-separated. */
  .tl-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  /* SVG dot: fixed box, so it never perturbs the row's height. */
  .tl-meta-dot {
    flex-shrink: 0;
    color: var(--text-faint);
  }

  /* Same visual language as a task's association (icon + label, plain color —
     projects and domains render identically; the icon carries the distinction). */
  .tl-assoc {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--text-muted);
    min-width: 0;
  }

  .tl-assoc.linked {
    cursor: pointer;
  }

  .tl-assoc.linked:hover .tl-assoc-label {
    text-decoration: underline;
  }

  .tl-assoc svg {
    flex-shrink: 0;
  }

  .tl-assoc-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tl-time {
    font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    cursor: text;
    align-self: flex-start;
  }

  /* ── Time editor (native time inputs) ── */
  .tl-time-edit {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .tl-time-input {
    font-size: 10px;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
    padding: 0 2px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 0;
    background: var(--background-primary);
    color: var(--text-normal);
    min-height: 0;
    height: auto;
    box-shadow: none;
  }

  .tl-time-dash {
    font-size: 10px;
    color: var(--text-muted);
  }

  .tl-tasks {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 0;
    overflow-y: auto;
  }
</style>