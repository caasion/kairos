<script lang="ts">
	// PROTOTYPE: yesterday's open tasks as a banner at the top of a view —
	// "deal with this now" — instead of a list mixed into the Inbox. Each row
	// is a LeftoverTask (checkbox marks it done where it was left, the arrow
	// brings it to today); the header brings all or leaves the rest. Purely
	// presentational: the view owns every write.

	import type { Leftover } from "../../carry";
	import type { Resolver } from "../../index";
	import LeftoverTask from "./LeftoverTask.svelte";

	interface Props {
		items: Leftover[];
		/** The day they were left on ("Tue, Oct 27"). */
		fromLabel: string;
		resolve: Resolver;
		onSettle: (l: Leftover, status: "x" | "-") => void;
		onBring: (l: Leftover) => void;
		onBringAll: () => void;
		onLeave: () => void;
	}

	let { items, fromLabel, resolve, onSettle, onBring, onBringAll, onLeave }: Props = $props();

	const weekday = $derived(fromLabel.split(",")[0]);
	const heading = $derived(
		`${items.length} ${items.length === 1 ? "task" : "tasks"} left open on ${weekday}`,
	);
</script>

<div class="lo-banner" role="region" aria-label={heading}>
	<div class="lo-banner-head">
		<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
		<span class="lo-banner-title" title={fromLabel}>{heading}</span>
		<span class="lo-banner-spacer"></span>
		<button class="lo-banner-btn" title={`Leave the rest open on ${fromLabel}`} onclick={onLeave}>
			Leave the rest
		</button>
		<button class="lo-banner-btn mod-cta" title="Move every task here to today's Unscheduled" onclick={onBringAll}>
			Bring all
		</button>
	</div>
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
</div>

<style>
	.lo-banner {
		margin: 6px 8px 2px;
		padding: 4px 4px 4px;
		border: 1px solid color-mix(in srgb, var(--color-orange) 45%, transparent);
		background: color-mix(in srgb, var(--color-orange) 10%, var(--background-primary));
		border-radius: var(--radius-m);
	}

	.lo-banner-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px 4px;
		color: var(--color-orange);
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-semibold);
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

	.lo-banner-btn {
		flex-shrink: 0;
		height: auto;
		padding: 1px 8px;
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-normal);
	}
</style>
