<script lang="ts">
	import type { Association, Block, ResolvedTask } from "../../types";
	import { isCheckable } from "../../types";

	interface Props {
		block: Block;
		tasks: ResolvedTask[];
		top: number;
		height: number;
		column: number;
		lanes: number;
	}

	let { block, tasks, top, height, column, lanes }: Props = $props();

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
	const widthPct = $derived(100 / lanes);
	const leftPct = $derived(column * widthPct);

	// A short block can't show its task chips; collapse to a compact look.
	const compact = $derived(height < 44);
</script>

<div
	class="tl-block"
	class:compact
	class:checked={blockChecked}
	style={`top: ${top}px; height: ${height}px; left: calc(${leftPct}% + 2px); width: calc(${widthPct}% - 4px);`}
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
			<div class="tl-chips">
				{#each chips as task (task.source.line)}
					<span
						class="tl-chip"
						class:done={task.status === "x"}
						class:cancelled={task.status === "-"}
						title={task.text}
					>
						<span class="tl-chip-dot" class:half={task.status === "/"}></span>
						{task.text}
					</span>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.tl-block {
		position: absolute;
		box-sizing: border-box;
		border: 1px solid var(--background-modifier-border);
		border-left: 3px solid var(--interactive-accent);
		border-radius: 5px;
		background: var(--background-secondary);
		padding: 4px 6px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 2px;
		transition: filter 0.12s;
	}

	.tl-block:hover {
		filter: brightness(1.08);
		z-index: 2;
	}

	.tl-block.checked {
		opacity: 0.6;
	}

	.tl-block.compact {
		flex-direction: row;
		align-items: center;
		padding: 2px 6px;
	}

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

	.tl-chips {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: 0;
		overflow: hidden;
	}

	.tl-chip {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tl-chip-dot {
		flex-shrink: 0;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--text-muted);
	}

	.tl-chip-dot.half {
		background: var(--text-accent);
	}

	.tl-chip.done,
	.tl-chip.cancelled {
		text-decoration: line-through;
		opacity: 0.5;
	}
</style>
