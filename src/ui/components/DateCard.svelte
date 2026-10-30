<script lang="ts">
	// A day column's header card: an uppercase label over a large serif value,
	// left-aligned, with badges in its bottom-right corner. The Week view's
	// date headers ("MON" over "27") and the Routines week's day headers ("TUE"
	// over "6h 30m") are this one card, so they read the same.
	//
	// Cards sit edge to edge, square, in a row; only the last one rounds its
	// top-right corner (the row's gutter spacer rounds the top-left). With
	// `onclick` it's a button that brightens on hover; without, a plain card.

	import type { Snippet } from "svelte";

	interface Props {
		/** The small uppercase line: "Mon". */
		label: string;
		/** The large serif line: "27", or "6h 30m". */
		value: string;
		/** Tint the card and underline it in the accent colour. */
		today?: boolean;
		title?: string;
		onclick?: (event: MouseEvent) => void;
		/** Badges over the card's bottom-right corner. */
		badges?: Snippet;
	}

	let { label, value, today = false, title, onclick, badges }: Props = $props();
</script>

{#snippet face()}
	<span class="date-card-label">{label}</span>
	<span class="date-card-value">{value}</span>
	{#if today}
		<span class="date-card-today"></span>
	{/if}
{/snippet}

<div class="date-card-wrap">
	{#if onclick}
		<button class="date-card is-button" class:today {title} {onclick}>{@render face()}</button>
	{:else}
		<div class="date-card" class:today {title}>{@render face()}</div>
	{/if}
	{#if badges}
		<div class="date-card-badges">{@render badges()}</div>
	{/if}
</div>

<style>
	.date-card-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
	}
	/* The two text lines flow normally; the today underline sits in the
	   reserved bottom strip (padding-bottom) so it never overlaps the value. */
	.date-card {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		background: var(--background-secondary);
		border: none;
		border-radius: 0;
		/* The header's bottom rule, carried on each card so it spans exactly the
		   columns below. */
		border-bottom: 1px solid var(--background-modifier-border);
		padding: var(--size-4-2) var(--size-4-2) var(--size-4-3) var(--size-4-3);
		height: 100%;
	}
	.date-card.is-button {
		cursor: pointer;
		box-shadow: none;
		transition: filter 150ms ease;
	}
	.date-card.is-button:hover {
		filter: brightness(1.15);
	}
	.date-card-wrap:last-child > .date-card {
		border-top-right-radius: var(--kairos-radius-l);
	}
	.date-card.today {
		background: color-mix(in srgb, var(--interactive-accent) 5%, var(--background-secondary));
	}
	.date-card-label {
		font-size: var(--kairos-text-label);
		font-weight: var(--font-semibold);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 1px;
		line-height: 1.4;
	}
	.date-card-value {
		max-width: 100%;
		font-family: var(--kairos-font-serif);
		font-size: var(--kairos-text-display);
		font-weight: 400;
		color: var(--text-normal);
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.date-card-today {
		position: absolute;
		left: 10%;
		bottom: -2px;
		width: 80%;
		height: 2px;
		background: var(--interactive-accent);
		border-radius: 1px;
	}
	.date-card-badges {
		position: absolute;
		right: var(--size-2-3);
		bottom: var(--size-2-3);
		display: flex;
		align-items: center;
		gap: 3px;
	}
</style>
