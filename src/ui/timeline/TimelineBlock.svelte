<script lang="ts">
  import type { Association, Block, ResolvedTask, Task, TaskStatus } from "../../types";
  import { isCheckable } from "../../types";
  import TaskComponent from "../task/Task.svelte";

  interface Props {
    block: Block;
    tasks: ResolvedTask[];
    top: number;
    height: number;
    column: number;
    lanes: number;
    selected?: boolean;
    dragging?: boolean;
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
    onGestureStart,
		onDelete,
		onSetTaskStatus,
		onSetTaskText,
		onDeleteTask,
  }: Props = $props();

  function fmt(minutes: number): string {
    const hh = Math.floor(minutes / 60);
    const mm = minutes % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  const timeLabel = $derived(
    block.time ? `${fmt(block.time.start)}–${fmt(block.time.end)}` : "",
  );

  function assocLabel(assoc: Association): string {
    return assoc.id;
  }

  const checkable = $derived(isCheckable(block));
  const blockChecked = $derived(block.task?.status === "x");

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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tl-block"
  class:selected
  class:dragging
  style={`top: ${top}px; height: ${height}px; left: calc(${leftPct}% + 2px); width: calc(${widthPct}% - 4px);`}
  onpointerdown={(e) => start("move", e)}
>
  <!-- Resize edges. Placed directly at the outer edge of tl-block -->
  <div
    class="tl-resize tl-resize-top"
    onpointerdown={(e) => {
      e.stopPropagation();
      start("resize-top", e);
    }}
  ></div>

	<!-- Delete button. Placed on the top right corner, appearing on hover. -->
	<button
		type="button"
		class="tl-delete-btn"
		title="Delete block"
		onpointerdown={(e) => e.stopPropagation()}
		onclick={(e) => {
			e.stopPropagation();
			onDelete(block);
		}}
	>
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
  </button>

  <!-- Inner visual container -->
  <div
    class="tl-content"
    class:compact
    class:checked={blockChecked}
  >
    <div class="tl-block-header">
      {#if checkable}
        <span class="tl-check" class:on={blockChecked}>{blockChecked ? "✓" : "○"}</span>
      {/if}
      <span class="tl-title">{block.title}</span>
      {#if block.assoc}
        <span class="tl-assoc" class:domain={block.assoc.kind === "domain"}>
          {assocLabel(block.assoc)}
        </span>
      {/if}
    </div>

    {#if !compact}
      <span class="tl-time">{timeLabel}</span>
      {#if chips.length > 0}
        <!-- Editable tasks. A press here must not start a block move/resize, so
             the container swallows pointerdown before it reaches the block. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="tl-tasks" onpointerdown={(e) => e.stopPropagation()}>
          {#each chips as task (task.source.line)}
            <TaskComponent
              {task}
              association={task.owner}
              inherited={task.assoc === undefined}
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

	/* Delete button */
	.tl-delete-btn {
		position: absolute;
		top: 4px;
		right: 4px;
		z-index: 10; /* Keep it above content and handles */
		
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

		/* Revealed on block hover. */
		opacity: 0;
		pointer-events: none; /* Prevents accidental clicks when invisible */
		transition: opacity 0.1s;
	}

	.tl-block:hover .tl-delete-btn {
		opacity: 1;
		pointer-events: auto; /* Re-enable pointer events on hover */
	}

	.tl-delete-btn:hover {
		color: var(--text-error);
		background: var(--background-modifier-hover);
	}

/* Block contents */
  .tl-block-header {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .tl-check {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-muted);
  }

  .tl-check.on {
    color: var(--text-accent);
  }

  .tl-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .checked .tl-title {
    text-decoration: line-through;
  }

  .tl-assoc {
    flex-shrink: 0;
    font-size: 9px;
    padding: 0 5px;
    border-radius: 7px;
    background: var(--background-modifier-border);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .tl-assoc.domain {
    background: var(--background-modifier-success);
  }

  .tl-time {
    font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .tl-tasks {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 0;
    overflow-y: auto;
  }
</style>