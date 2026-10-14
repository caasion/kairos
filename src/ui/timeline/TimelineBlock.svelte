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
  import { parseEndClock, parseStartClock } from "../../parser";
  import {
    blockLit,
    hoverBlockTarget,
    hoverTaskTarget,
    taskHighlight,
    type HoverTarget,
  } from "../../viewLinks";
  import type { Resolver } from "../../index";
  import { peek } from "../actions/peek";
  import { Menu } from "obsidian";
  import TaskComponent from "../task/Task.svelte";
  import { requestRepeat } from "../../routines/repeat";
  import { addBlockMenuItems } from "../blockMenu";
  import TaskCheckbox from "../task/TaskCheckbox.svelte";
  import { actionZone } from "../actions/actionZone";
  import { tooltip } from "../actions/tooltip";
  import { blockInUse, focusInBlock, pressInBlock } from "./blockGrow";

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
		// Open the block picker to nest a task under another block, anchored at
		// `rect`. The owning block travels along so the writer can locate the task.
		onNestTask: (owner: Block, task: Task, rect: DOMRect) => void;
		// Move a nested task off the day and back into the backlog. The owning block
		// travels along so the parent can locate the task and lift its inherited
		// association before dropping it.
		onMoveTaskToBacklog: (owner: Block, task: Task) => void;
		// A long-press on a task body began a drag-to-nest gesture. The parent (the
		// canvas owner) takes over window pointer tracking, previews a drop slot,
		// and commits the nest on release. Reports the source block + task + press.
		onTaskGrab: (owner: Block, task: Task, event: PointerEvent) => void;
		// While a task drag is live, the parent sets this to the source line of the
		// task being dragged so its origin row can dim, and to the insertion slot
		// (target block line + index) so this block can render a drop indicator.
		dragTaskLine?: number;
		dropSlot?: { blockLine: number; index: number };
		// True while ANY task drag is in progress. Every block renders its drop
		// zone then (even an empty one), so the parent's hit-test can find a block
		// with no tasks — otherwise that block would have no `data-drop-block`
		// element to target and could never receive a dropped task.
		dragActive?: boolean;
		// Block field write-back.
		onSetBlockTitle: (block: Block, title: string) => void;
		onSetBlockTime: (block: Block, time: TimeRange) => void;
		onSetBlockStatus: (block: Block, status: TaskStatus) => void;
		// Toggle whether the block is a checkable task (adds/removes its checkbox).
		onToggleCheckable: (block: Block) => void;
		// Create a new child task inside this block.
		onAddTask: (block: Block) => void;
		// Notes (decision 96): add one at the end, or set note `index`'s text
		// (blank deletes it).
		onAddNote: (block: Block, text: string) => void;
		onSetNoteText: (block: Block, index: number, text: string) => void;
		// Open the association picker for this block, anchored at `rect`.
		onEditAssoc: (block: Block, rect: DOMRect) => void;
		// Hover link (viewLinks.ts): the item under the pointer in any view, so
		// this block or one of its chips can glow when it's that item. The two
		// callbacks report this block or a chip coming under / leaving the pointer.
		hover?: HoverTarget | null;
		onHoverEnter?: (target: HoverTarget) => void;
		onHoverLeave?: (target: HoverTarget) => void;
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
		onNestTask,
		onMoveTaskToBacklog,
		onTaskGrab,
		dragTaskLine,
		dropSlot,
		dragActive = false,
		onSetBlockTitle,
		onSetBlockTime,
		onSetBlockStatus,
		onToggleCheckable,
		onAddTask,
		onAddNote,
		onSetNoteText,
		onEditAssoc,
		hover = null,
		onHoverEnter,
		onHoverLeave,
  }: Props = $props();

  // ── Hover link ──
  // One rule for every view (viewLinks.ts): pointing at this block or at any
  // task in it lights the block; the task pointed at is marked on its own chip.
  const blockTarget = $derived(hoverBlockTarget(block));
  const blockLinked = $derived(blockLit(hover, block));
  // Leaving a chip returns the hover to the block it sits in; leaving the block
  // (which fires after its chip's leave) then clears it.
  function chipHover(task: Task, on: boolean) {
    if (removed) return;
    onHoverEnter?.(on ? hoverTaskTarget(task, block) : blockTarget);
  }
  // A block removed under the pointer gets no leave event, so it clears its own
  // hover on teardown (clearHover only acts if the hover still names it). Its
  // chips may tear down after it; `removed` stops them handing the hover back.
  let removed = false;
  $effect(() => () => {
    removed = true;
    onHoverLeave?.(blockTarget);
  });

  // The drop indicator's index within this block, when the live task drag is
  // hovering here. Undefined when the drag targets another block (or none).
  const dropIndex = $derived(
    dropSlot && dropSlot.blockLine === block.source.line
      ? dropSlot.index
      : undefined,
  );

  // True when this block is the current drop target — highlight the whole block
  // so dropping anywhere on it reads as "lands here" (append), not only over the
  // task strip.
  const isDropTarget = $derived(dropIndex !== undefined);

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
  const notes = $derived(block.notes ?? []);

  // ── Notes (decision 96) ──
  // A note is edited in place like a task's text; clearing it deletes it. A
  // new note starts as an empty row and is only written once it has text.
  let editingNote = $state<number | null>(null);
  let addingNote = $state(false);
  let noteDraft = $state("");

  function focusOnMount(node: HTMLInputElement) {
    queueMicrotask(() => node.focus());
  }

  function beginNoteEdit(index: number) {
    noteDraft = notes[index]?.text ?? "";
    addingNote = false;
    editingNote = index;
  }

  function beginNoteAdd() {
    noteDraft = "";
    editingNote = null;
    addingNote = true;
    // Grow the block so the new row is in view.
    expand();
  }

  function commitNote() {
    const text = noteDraft.trim();
    if (addingNote) {
      addingNote = false;
      if (text) onAddNote(block, text);
    } else if (editingNote !== null) {
      const index = editingNote;
      editingNote = null;
      if (text !== notes[index]?.text) onSetNoteText(block, index, text);
    }
  }

  function cancelNote() {
    addingNote = false;
    editingNote = null;
  }

  function onNoteKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitNote();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelNote();
    }
  }

  function openNoteMenu(event: MouseEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("Edit note").setIcon("pencil").onClick(() => beginNoteEdit(index)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Delete note")
        .setIcon("trash")
        .onClick(() => onSetNoteText(block, index, "")),
    );
    menu.showAtMouseEvent(event);
  }

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
    // A move or resize works on the block's real size.
    collapse();
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
    // A native time input can't hold "24:00"; midnight shows as "00:00" and
    // parseEndClock reads it back as the end of the day.
    endDraft = block.time.end >= 24 * 60 ? "00:00" : fmt(block.time.end);
    editingTime = true;
  }

  function commitTimeEdit() {
    if (!editingTime) return;
    const start = parseStartClock(startDraft);
    const end = start === undefined ? undefined : parseEndClock(endDraft, start);
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

  // ── Showing every task ──
  // A block shows as many of its tasks as fit. When they don't all fit, the
  // last row it has room for becomes a "N more" row, centred at the bottom of
  // the task list; a block with room for one row or less shows only that row
  // ("N tasks"), and a compact block a small pill beside its title. Pointing at
  // it (mouse) or tapping it (touch) makes the block itself grow down until all
  // its tasks fit, over whatever is below, and shrink back once the pointer
  // leaves the block. It stays the same block: same width, same look.
  let tasksEl = $state<HTMLDivElement>();
  let moreEl = $state<HTMLElement>();
  let taskAreaHeight = $state(0);
  // One task row's height, measured from a rendered row (a sane default until
  // one renders).
  let rowHeight = $state(21);
  let expanded = $state(false);
  let expandTimer: number | undefined;
  // A pointer passing over on its way to the resize edge shouldn't expand it.
  const EXPAND_MS = 250;
  const COLLAPSE_MS = 150;

  function measureTaskArea() {
    // While grown, the list is as tall as its tasks; that isn't the room the
    // block has, so keep the last measure.
    const el = tasksEl;
    if (!el || expanded) return;
    taskAreaHeight = el.clientHeight;
    const row = el.querySelector<HTMLElement>(".tl-task-wrap");
    if (row && row.offsetHeight > 0) rowHeight = row.offsetHeight;
  }
  $effect(() => {
    const el = tasksEl;
    if (!el) return;
    measureTaskArea();
    const ro = new ResizeObserver(() => measureTaskArea());
    ro.observe(el);
    return () => ro.disconnect();
  });

  // How many rows the block has room for (none when compact). Rows are its
  // tasks, then its notes, then a note being added.
  const capacity = $derived(
    compact ? 0 : Math.max(0, Math.floor((taskAreaHeight + 0.5) / rowHeight)),
  );
  const rowCount = $derived(chips.length + notes.length + (addingNote ? 1 : 0));
  // During a drag every block shows all its rows: they are the drop slots.
  const overflowing = $derived(!dragActive && rowCount > capacity);
  const room = $derived(overflowing && !expanded ? Math.max(0, capacity - 1) : rowCount);
  const shownChips = $derived(chips.slice(0, room));
  const shownNotes = $derived(notes.slice(0, Math.max(0, room - chips.length)));
  const hiddenCount = $derived(overflowing ? rowCount - Math.max(0, capacity - 1) : 0);
  // What's hidden: tasks (they come first) when no note is, notes when no task
  // is, else both.
  const hiddenNoun = $derived.by(() => {
    const one = hiddenCount === 1;
    if (shownChips.length + hiddenCount <= chips.length) return one ? "task" : "tasks";
    if (shownChips.length === chips.length) return one ? "note" : "notes";
    return "items";
  });
  const moreLabel = $derived(
    capacity <= 1 ? `${hiddenCount} ${hiddenNoun}` : `${hiddenCount} more`,
  );
  // A compact block that grows lays out like a full one, so its tasks show.
  const compactLayout = $derived(compact && !expanded);

  function cancelExpandTimer() {
    window.clearTimeout(expandTimer);
    expandTimer = undefined;
  }
  function expand() {
    cancelExpandTimer();
    expanded = true;
  }
  function collapse() {
    cancelExpandTimer();
    expanded = false;
  }
  // Hover drives it for a mouse only. A touch "leaves" the moment the finger
  // lifts, so touch grows it with a tap and shrinks it with a tap elsewhere.
  function onMoreEnter(event: PointerEvent) {
    if (event.pointerType !== "mouse" || expanded) return;
    cancelExpandTimer();
    expandTimer = window.setTimeout(expand, EXPAND_MS);
  }
  function onMoreLeave(event: PointerEvent) {
    // Left before it grew: don't grow.
    if (event.pointerType === "mouse" && !expanded) cancelExpandTimer();
  }
  function onBlockEnter(event: PointerEvent) {
    if (event.pointerType === "mouse" && expanded) cancelExpandTimer();
  }
  function onBlockLeave(event: PointerEvent) {
    if (event.pointerType !== "mouse" || !expanded) return;
    scheduleCollapse();
  }
  // Shrink once the pointer has been gone a moment, but not while the block
  // is still in use from outside its box (see blockGrow.ts): the pointer on a
  // task's action stack, portaled to the body, or a menu or picker a task
  // opened. Shrinking then would unmount the very task in use. Wait until
  // that's done instead. Keep it, too, while something in it has focus (a task
  // being edited); a press elsewhere shrinks it then.
  function scheduleCollapse() {
    cancelExpandTimer();
    expandTimer = window.setTimeout(() => {
      expandTimer = undefined;
      const el = blockEl;
      if (!el || focusInBlock(el)) return;
      if (blockInUse(el)) scheduleCollapse();
      else expanded = false;
    }, COLLAPSE_MS);
  }
  // While grown: a press anywhere else shrinks it (the way back on touch), and
  // so does leaving a focused task once the pointer is gone. A press on its
  // tasks' portaled stacks, menus or pickers isn't elsewhere: shrinking on the
  // pointerdown would unmount the button before its click.
  $effect(() => {
    const el = blockEl;
    if (!expanded || !el) return;
    const win = el.ownerDocument.defaultView ?? window;
    const onPress = (e: PointerEvent) => {
      if (!pressInBlock(el, e.target)) collapse();
    };
    win.addEventListener("pointerdown", onPress, true);
    return () => win.removeEventListener("pointerdown", onPress, true);
  });
  // A drag shows every row anyway, as drop slots.
  $effect(() => {
    if (dragActive) collapse();
  });

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
    addBlockMenuItems(menu, block, {
      onAddTask: () => onAddTask(block),
      onAddNote: () => beginNoteAdd(),
      onEditAssoc: () => requestEditAssoc(),
      onToggleCheckable: () => onToggleCheckable(block),
      onSetStatus: (status) => onSetBlockStatus(block, status),
      onDelete: () => onDelete(block),
    });
    menu.showAtMouseEvent(event);
  }
</script>

<!-- The "N more" control: a row in the task list, or a pill beside a compact
     block's title. -->
{#snippet moreButton(pill: boolean)}
  <button
    type="button"
    class="tl-more"
    class:pill
    style={pill ? undefined : `height: ${rowHeight}px;`}
    bind:this={moreEl}
    aria-label={`Show all ${rowCount} rows`}
    aria-expanded={expanded}
    onpointerdown={(e) => e.stopPropagation()}
    onpointerenter={onMoreEnter}
    onpointerleave={onMoreLeave}
    onclick={(e) => {
      e.stopPropagation();
      expand();
    }}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    {moreLabel}
  </button>
{/snippet}

<!-- One task chip. -->
{#snippet chip(task: ResolvedTask, tr: ReturnType<Resolver> | undefined)}
  <TaskComponent
    {task}
    association={task.owner}
    inherited={task.assoc === undefined}
    resolved={tr}
    color={tr?.color}
    onNavigate={() => task.owner && onNavigate(task.owner)}
    onEditAssoc={(rect) => onEditTaskAssoc(block, task, rect)}
    onNest={(rect) => onNestTask(block, task, rect)}
    onMoveToBacklog={() => onMoveTaskToBacklog(block, task)}
    onRepeat={() => requestRepeat(task, block)}
    onGrab={(e) => {
      collapse();
      onTaskGrab(block, task, e);
    }}
    onSetStatus={(t, status) => onSetTaskStatus(block, t, status)}
    onSetText={(t, text) => onSetTaskText(block, t, text)}
    onDelete={(t) => onDeleteTask(block, t)}
    highlight={taskHighlight(hover, task, block) === "task" ? "task" : null}
    onHoverChange={(on: boolean) => chipHover(task, on)}
  />
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tl-block"
  class:selected
  class:dragging
  class:linked={blockLinked}
  class:expanded
  style:--kairos-link-color={accentColor}
  data-block-line={block.source.line}
  bind:this={blockEl}
  style={`top: ${top}px; ${expanded ? `min-height: ${height}px;` : `height: ${height}px;`} left: calc(${leftPct}% + 2px); width: calc(${widthPct}% - 4px);`}
  onpointerdown={(e) => start("move", e)}
  oncontextmenu={openContextMenu}
  onpointerenter={(e) => {
    onHoverEnter?.(blockTarget);
    onBlockEnter(e);
  }}
  onpointerleave={(e) => {
    onHoverLeave?.(blockTarget);
    onBlockLeave(e);
  }}
  use:actionZone={{ layout: "stack" }}
>
  <!-- Resize edges. Placed directly at the outer edge of tl-block -->
  <div
    class="tl-resize tl-resize-top"
    onpointerdown={(e) => {
      e.stopPropagation();
      start("resize-top", e);
    }}
  ></div>

	<!-- Action bar: add-task + add-note + convert + delete, top-right corner. Woken from
	     the top-right corner zone (see actions/actionZone.ts), not on any hover.
	     On a mouse wake it's a vertical stack: delete stays in the corner and
	     the rest rise above it (above the block). Touch keeps the bar. -->
	<div class="tl-actions kairos-action-bar">
		<button
			type="button"
			class="tl-action-btn"
			aria-label="Add task"
			use:tooltip={"Add task"}
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
			class="tl-action-btn"
			aria-label="Add note"
			use:tooltip={"Add note"}
			onpointerdown={(e) => e.stopPropagation()}
			onclick={(e) => {
				e.stopPropagation();
				beginNoteAdd();
			}}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/></svg>
		</button>
		<button
			type="button"
			class="tl-action-btn"
			aria-label={checkable ? "Convert to block" : "Convert to task"}
			use:tooltip={checkable ? "Convert to block" : "Convert to task"}
			onpointerdown={(e) => e.stopPropagation()}
			onclick={(e) => {
				e.stopPropagation();
				onToggleCheckable(block);
			}}
		>
			{#if checkable}
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
			{/if}
		</button>
		<button
			type="button"
			class="tl-action-btn tl-action-danger"
			aria-label="Delete block"
			use:tooltip={"Delete block"}
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
    class:compact={compactLayout}
    class:checked={blockChecked}
    class:drop-target={isDropTarget}
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
          class="tl-title-input kairos-inline-input"
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
          use:peek={{ text: block.title }}
        >{block.title}</span>
      {/if}
      {#if compactLayout && hiddenCount > 0}
        {@render moreButton(true)}
      {/if}
    </div>

    {#if !compactLayout}
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
        <div class="kairos-meta-row" bind:this={metaEl}>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <span
            class="tl-time kairos-meta kairos-meta-label"
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
              class="kairos-meta-dot"
              width="3"
              height="3"
              viewBox="0 0 3 3"
              aria-hidden="true"
            ><circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" /></svg>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="kairos-meta"
              class:is-linked={r.resolved}
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
              <span class="kairos-meta-label">{r.displayName}</span>
            </span>
          {/if}
        </div>
      {/if}
      {#if rowCount > 0 || dragActive}
        <!-- Editable tasks. A press here must not start a block move/resize, so
             the container swallows pointerdown before it reaches the block.
             `data-drop-block` lets the parent's drag hit-test find this list —
             rendered for every block during a drag (via `dragActive`) so even an
             empty block is a droppable target. `drag-active` lifts the overflow
             clip so a drop line at the list's edge isn't cut off. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tl-tasks"
          class:drag-active={dragActive}
          bind:this={tasksEl}
          data-drop-block={block.source.line}
          onpointerdown={(e) => e.stopPropagation()}
        >
          {#each shownChips as task, i (task.source.line)}
            {@const tr = task.owner ? resolve(task.owner) : undefined}
            <!-- Drop indicator before this row when the drag targets slot `i`. -->
            {#if dropIndex === i}
              <div class="tl-drop-line"></div>
            {/if}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="tl-task-wrap"
              class:dragging-origin={dragTaskLine === task.source.line}
              data-task-line={task.source.line}
              data-task-index={i}
            >
              {@render chip(task, tr)}
            </div>
          {/each}
          {#each shownNotes as note, n (n)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="tl-note" oncontextmenu={(e) => openNoteMenu(e, n)}>
              <span class="tl-note-bullet" aria-hidden="true"></span>
              {#if editingNote === n}
                <input
                  class="tl-note-text tl-note-input kairos-inline-input"
                  type="text"
                  bind:value={noteDraft}
                  use:focusOnMount
                  onkeydown={onNoteKeydown}
                  onblur={commitNote}
                />
              {:else}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <span
                  class="tl-note-text"
                  role="textbox"
                  tabindex="0"
                  onclick={() => beginNoteEdit(n)}
                  use:peek={{ text: note.text }}
                >{note.text}</span>
              {/if}
            </div>
          {/each}
          {#if addingNote && (!overflowing || expanded)}
            <div class="tl-note">
              <span class="tl-note-bullet" aria-hidden="true"></span>
              <input
                class="tl-note-text tl-note-input kairos-inline-input"
                type="text"
                placeholder="What happened?"
                bind:value={noteDraft}
                use:focusOnMount
                onkeydown={onNoteKeydown}
                onblur={commitNote}
              />
            </div>
          {/if}
          <!-- Trailing drop zone: carries the append indicator inside a padded,
               non-clipped element so a line at the list's bottom edge isn't cut. -->
          {#if overflowing && !expanded}
            {@render moreButton(false)}
          {/if}
          {#if dragActive}
            <div class="tl-drop-tail">
              {#if dropIndex !== undefined && dropIndex >= chips.length}
                <div class="tl-drop-line"></div>
              {/if}
            </div>
          {/if}
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

  /* Hover link: this block, or a task in it, is under the pointer in some view
     (this one included). Outlined and tinted in its domain color (the theme
     accent without one); the task itself is marked on its chip. */
  .tl-block.linked .tl-content {
    box-shadow: 0 0 0 2px var(--kairos-link-color, var(--interactive-accent));
    background: color-mix(
      in srgb,
      var(--kairos-link-color, var(--interactive-accent)) 12%,
      var(--background-secondary)
    );
  }

  /* Whole-block drop highlight: dropping anywhere on it appends the task. */
  .tl-content.drop-target {
    box-shadow: inset 0 0 0 2px var(--interactive-accent);
    background: color-mix(
      in srgb,
      var(--interactive-accent) 10%,
      var(--background-secondary)
    );
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

	/* Hover action bar (add-task + convert + delete), top-right corner. */
	.tl-actions {
		position: absolute;
		top: 4px;
		right: 4px;
		z-index: 10; /* Above content and resize handles. */

		display: flex;
		gap: 2px;
		background: var(--background-secondary);

		/* Shown/hidden by the shared .kairos-action-bar rules in styles.css. */
		--kairos-action-bar-opacity: 1;
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

	/* Stack layout (styles.css): delete takes the corner cell. */
	.tl-action-danger {
		order: -1;
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

  /* The time + association line is the shared `.kairos-meta` family from
     styles.css — same size, colour, icon treatment and hover cue as a task's
     association line, which this used to copy by hand. It takes no indent: it
     sits under the block title, not under a checkbox. Projects and domains
     render identically here; the icon carries the distinction.

     Local to the timeline: the time doubles as the click target for the inline
     time editor, stays top-aligned in a short block, and never truncates —
     it is short and fixed-width, so a narrow block should eat into the
     association's name rather than turn "09:00–10:00" into "09:00–10:0…". */
  .tl-time {
    cursor: text;
    align-self: flex-start;
    flex-shrink: 0;
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

  /* ── Showing every task ── */
  /* The "N more" row: one task row's worth of space at the bottom of the list,
     centred, so it's an easy target that keeps clear of the resize edges. */
  .tl-more {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    width: 100%;
    padding: 0 4px;
    border: none;
    border-radius: var(--radius-s);
    box-shadow: none;
    background: transparent;
    font-size: 11px;
    line-height: 1;
    color: var(--text-muted);
    cursor: pointer;
  }
  .tl-more:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }
  /* Beside a compact block's title: a small pill, centred in the space after
     the title, clear of the action corner on the right. */
  .tl-more.pill {
    width: auto;
    height: 16px;
    margin-inline: auto;
    padding: 0 6px;
    border-radius: 8px;
    font-size: 10px;
    background: var(--background-secondary-alt);
  }
  .tl-more svg {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
  }

  /* Grown to show every task: the block's own height gives way to its
     content, over the blocks below, lifted a little so it reads as on top.
     Its bottom resize edge steps aside: it would sit at the grown edge, not
     the block's real end. */
  .tl-block.expanded {
    z-index: 7;
  }
  .tl-block.expanded .tl-content {
    box-shadow: var(--shadow-s);
  }
  .tl-block.expanded .tl-tasks {
    flex: none;
  }
  .tl-block.expanded .tl-resize-bottom {
    display: none;
  }

  /* The task list takes the room left under the header, whatever it holds,
     so its height says how many rows fit (see `capacity`). What doesn't fit
     goes behind the "N more" row, not a scrollbar. */
  .tl-tasks {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* During a drag, stop clipping so a drop line at the list's edge shows, and
     reserve a little room below the last row for the append indicator. */
  .tl-tasks.drag-active {
    overflow: visible;
  }

  /* ── Task drag-to-nest ── */
  .tl-task-wrap {
    min-width: 0;
  }

  /* A note: a task row's box and type, with a small dot where the checkbox
     would be and muted text, so it reads as a record, not something to do. */
  .tl-note {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 2px 4px;
  }
  .tl-note-bullet {
    flex: none;
    width: 18px;
    display: flex;
    justify-content: center;
  }
  .tl-note-bullet::before {
    content: "";
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .tl-note-text {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text;
  }
  input.tl-note-input {
    padding: 0;
    font-family: inherit;
    color: var(--text-normal);
  }

  /* The origin row dims while its task is being dragged elsewhere. */
  .tl-task-wrap.dragging-origin {
    opacity: 0.35;
  }

  /* Insertion indicator between task rows (or at the list ends). */
  .tl-drop-line {
    height: 0;
    border-top: 2px solid var(--interactive-accent);
    margin: -1px 0;
  }

  /* Trailing drop zone below the last row: a padded, non-clipped home for the
     append indicator so a line at the list's bottom edge isn't cut off. The
     whole-block highlight (.tl-content.drop-target) is the primary "lands here"
     cue, so this stays a thin strip. */
  .tl-drop-tail {
    min-height: 6px;
    flex-shrink: 0;
  }
</style>