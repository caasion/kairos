<script lang="ts">
	// Yesterday's open tasks as a one-line bar at the top of the Day
	// view — there until dealt with, but folded: "Review" opens the list. Each row
	// is a LeftoverTask (checkbox marks it done where it was left, the arrow
	// brings it to today); the header brings all or leaves the rest. Purely
	// presentational: the view owns every write.

	import type { Leftover } from "../../carry";
	import type { Resolver } from "../../index";
	import LeftoverTask from "./LeftoverTask.svelte";
	import LeftoverButtons from "./LeftoverButtons.svelte";

	interface Props {
		items: Leftover[];
		/** The day they were left on ("Tue, Oct 27"), for the rows' tooltips. */
		fromLabel: string;
		/** "Left open", or "Left open on Fri" after a gap (leftOpenLabel). */
		label: string;
		resolve: Resolver;
		onSettle: (l: Leftover, status: "x" | "-") => void;
		onBring: (l: Leftover) => void;
		onBringAll: () => void;
		onLeave: () => void;
	}

	let { items, fromLabel, label, resolve, onSettle, onBring, onBringAll, onLeave }: Props = $props();

	const heading = $derived(`${label}: ${items.length}`);
	let reviewing = $state(false);
</script>

<div class="lo-banner" role="region" aria-label={heading}>
	<div class="lo-banner-head">
		<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
		<span class="lo-banner-title">{label}</span>
		<span class="kairos-count">{items.length}</span>
		<span class="lo-banner-spacer"></span>
		<button class="lo-banner-btn" aria-expanded={reviewing} onclick={() => (reviewing = !reviewing)}>
			{reviewing ? "Hide" : "Review"}
		</button>
		<LeftoverButtons {onLeave} {onBringAll} />
	</div>
	{#if reviewing}
	<div class="lo-banner-list">
		{#each items as l (l.task.source.line)}
			{@const assoc = l.task.assoc ?? l.owner.assoc}
			<LeftoverTask
				task={l.task}
				resolved={assoc ? resolve(assoc) : undefined}
				{fromLabel}
				onDone={() => onSettle(l, "x")}
				onCancel={() => onSettle(l, "-")}
				onBring={() => onBring(l)}
			/>
		{/each}
	</div>
	{/if}
</div>

<style>
	/* A quiet line under the tray, not a box: the Inbox pill above carries the
	   alert color, and here only Review does. */
	.lo-banner {
		margin: 0 8px 2px;
		padding: 0 2px;
	}

	.lo-banner-head {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
	}

	.lo-banner-head svg {
		flex-shrink: 0;
	}

	.lo-banner-title {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.lo-banner-spacer {
		flex: 1;
	}

	/* Review is the step to take, so it carries the alert color. */
	.lo-banner-btn {
		flex-shrink: 0;
		height: auto;
		padding: var(--size-2-1) var(--size-2-3);
		border: none;
		border-radius: var(--radius-s);
		background: transparent;
		box-shadow: none;
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-semibold);
		color: var(--color-orange);
		cursor: pointer;
	}
	.lo-banner-btn:hover {
		background: color-mix(in srgb, var(--color-orange) 12%, transparent);
	}
</style>
