<script lang="ts">
	// The marks in a Grid cell's bottom-right corner where a row's intention or
	// intensity changes: a notebook icon and/or a small arrow with the new
	// intensity bars, in the row's colour. Pointing at them (or pressing and
	// holding on touch) opens a hover card that reads the change out: the
	// project, the day, the new intention and the one it replaces, and the
	// intensity it moves from and to.
	//
	// The marks are tiny, so their hit area reaches past them (padding), while
	// the glyphs stay where and how they were. The cell's floating "+" keeps
	// clear of them; GridView passes it this element's width.

	import { formatShortDate } from "../../dayNote";
	import type { ISODate } from "../../types";
	import { hoverHold } from "../actions/hoverHold";
	import { icon } from "../actions/icon";
	import { placeUnderAnchor } from "../floating";
	import HoverCard from "../components/HoverCard.svelte";
	import IntensityBars from "../components/IntensityBars.svelte";

	let {
		name,
		color,
		date,
		intention,
		intensity,
		width = $bindable(0),
	}: {
		/** The row's project or domain. */
		name: string;
		color?: string;
		date: ISODate;
		intention: { from: string | null; to: string } | null;
		intensity: { from: number | null; to: number } | null;
		/** The marks' width, hit area included, for the cell's "+" to keep clear of. */
		width?: number;
	} = $props();

	let open = $state(false);
	let anchorEl = $state<HTMLElement>();
	let cardEl = $state<HTMLDivElement>();
	let cardStyle = $state("left: -9999px; top: -9999px;");

	// Under the marks, flipped above near the bottom edge, once the card's real
	// size is known; off-screen until then so it never flashes at a stale spot.
	$effect(() => {
		if (!open || !anchorEl || !cardEl) return;
		cardStyle = placeUnderAnchor(anchorEl.getBoundingClientRect(), {
			width: cardEl.offsetWidth,
			height: cardEl.offsetHeight,
			margin: 4,
		});
	});
	$effect(() => {
		if (!open) cardStyle = "left: -9999px; top: -9999px;";
	});

	const up = $derived(
		intensity !== null && (intensity.from === null || intensity.to > intensity.from),
	);
</script>

<span
	class="grid-cell-marks"
	style:color
	bind:this={anchorEl}
	bind:offsetWidth={width}
	use:hoverHold={{ onopen: () => (open = true), onclose: () => (open = false) }}
>
	{#if intention}
		<span class="grid-intention-change" use:icon={"notebook-pen"}></span>
	{/if}
	{#if intensity}
		<span class="grid-intensity-change">
			<span class="grid-intensity-arrow">{up ? "↑" : "↓"}</span>
			<IntensityBars level={intensity.to} />
		</span>
	{/if}
</span>

{#if open}
	<HoverCard {color} style={cardStyle} bind:el={cardEl}>
		<span class="kairos-hover-card-name">{name}</span>
		<div class="kairos-hover-card-desc">
			{intention ? "New intention" : `Intensity ${up ? "up" : "down"}`}
			<span class="kairos-hover-card-dim">· {formatShortDate(date)}</span>
		</div>
		{#if intention}
			<div class="kairos-hover-card-note grid-marks-intention">{intention.to}</div>
		{/if}
		{#if intention?.from || intensity}
			<dl class="kairos-hover-card-facts">
				{#if intention?.from}
					<dt>Before</dt>
					<dd class="kairos-hover-card-dim">{intention.from}</dd>
				{/if}
				{#if intensity}
					<dt>Intensity</dt>
					<dd>
						{#if intensity.from !== null}
							<span class="kairos-hover-card-bars"><IntensityBars level={intensity.from} /></span>
							<span class="kairos-hover-card-dim">({intensity.from})</span>
						{:else}
							<span class="kairos-hover-card-dim">Unset</span>
						{/if}
						<span class="kairos-hover-card-dim">→</span>
						<span class="kairos-hover-card-bars" style:color
						><IntensityBars level={intensity.to} /></span>
						<span class="kairos-hover-card-dim">({intensity.to})</span>
					</dd>
				{/if}
			</dl>
		{/if}
	</HoverCard>
{/if}

<style>
	/* Tucked in the cell's bottom-right corner, under task action bars and the
	   cell's "+" (both sit higher). The padding is the hit area: the glyphs
	   sit 4px from the right and 2px from the bottom, as before. */
	.grid-cell-marks {
		position: absolute;
		right: 0;
		bottom: 0;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 4px 2px 6px;
		color: var(--text-faint);
		font-size: var(--kairos-text-meta);
		line-height: 1;
		opacity: 0.85;
		cursor: default;
		/* A held finger opens the card instead of selecting text. */
		user-select: none;
		-webkit-touch-callout: none;
	}
	.grid-intention-change {
		display: inline-flex;
		--icon-size: 10px;
		--icon-stroke: 2.25px;
	}
	.grid-intensity-change {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.grid-intensity-arrow {
		margin-right: 1px;
	}
	.grid-marks-intention {
		margin-top: 2px;
	}
</style>
