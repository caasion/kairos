<script lang="ts">
	// A Grid/Gantt row label: the entity name, top-left aligned, with its status
	// note as a muted subline (hidden when empty), intensity bars beside the name
	// when the caller supplies a level, and — for domains — the domain icon on the
	// right, tinted the domain's color. Hovering the label opens a
	// portaled info card (description, status + note, active since/until) so the
	// full context is one hover away without cluttering the compact row.
	//
	// Purely presentational: it owns only the hover/popover state. The group
	// accent stripe is drawn by the parent (it spans multiple rows), not here.

	import { formatShortDate } from "../../dayNote";
	import type { RowLabelInfo } from "./rowLabel";
	import HoverCard from "./HoverCard.svelte";
	import IntensityBars from "./IntensityBars.svelte";

	let { info }: { info: RowLabelInfo } = $props();

	// ── Hover card ──
	let hovering = $state(false);
	let anchorEl = $state<HTMLElement>();
	let cardStyle = $state("left: -9999px; top: -9999px;");
	let cardEl = $state<HTMLDivElement>();

	function open() {
		hovering = true;
	}
	function close() {
		hovering = false;
	}

	// Place the card just to the right of the row label, vertically centered on it,
	// clamped inside the viewport. Measured after render (cardEl) so its real size
	// is known before positioning — until then it sits off-screen.
	$effect(() => {
		if (!hovering || !anchorEl || !cardEl) return;
		const a = anchorEl.getBoundingClientRect();
		const cw = cardEl.offsetWidth;
		const ch = cardEl.offsetHeight;
		const gap = 8;
		let left = a.right + gap;
		// Flip to the left of the row if it would overflow the right edge.
		if (left + cw > window.innerWidth - 8) left = Math.max(8, a.left - gap - cw);
		let top = a.top + a.height / 2 - ch / 2;
		top = Math.max(8, Math.min(top, window.innerHeight - ch - 8));
		cardStyle = `left: ${left}px; top: ${top}px;`;
	});

	// Reset to off-screen when closed so the next open never flashes at a stale spot.
	$effect(() => {
		if (!hovering) cardStyle = "left: -9999px; top: -9999px;";
	});


	const statusLabel = $derived(
		info.status.charAt(0).toUpperCase() + info.status.slice(1),
	);
	// The status dot goes before the first line under the name: the note,
	// else the description, else the name itself.
	const dotLine = $derived(
		info.note.trim() !== ""
			? "note"
			: info.description.trim() !== ""
				? "description"
				: "name",
	);
	const rolledUp = $derived(info.rolledUp ?? []);
	const rolledUpText = $derived(rolledUp.join(", "));
	const hasCardBody = $derived(
		info.description.trim() !== "" ||
			info.note.trim() !== "" ||
			info.since !== null ||
			info.intensity !== undefined ||
			rolledUp.length > 0,
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="row-label"
	class:domain={info.isDomain}
	bind:this={anchorEl}
	onmouseenter={open}
	onmouseleave={close}
>
	<div class="row-label-text">
		<span class="row-label-line">
			<span class="row-label-name" title={info.name}>{info.name}</span>
			{#if info.intensity}
				<span
					class="row-label-pips"
					style={info.color ? `color: ${info.color};` : undefined}
				>
					<IntensityBars level={info.intensity.level} />
				</span>
			{/if}
		</span>
		{#if info.note.trim() !== ""}
			<span class="row-label-note" title={info.note}>{info.note}</span>
		{/if}
		{#if rolledUp.length > 0}
			<!-- Projects shown on this domain's row (#11): they have no row of
			     their own, so the label keeps them visible. Truncates; the hover
			     card lists them in full. -->
			<span class="row-label-note row-label-rollup" title={rolledUpText}>+ {rolledUpText}</span>
		{/if}
	</div>
	{#if info.isDomain}
		<!-- Domain icon, tinted the domain's color. -->
		<svg
			class="row-label-icon"
			style={info.color ? `color: ${info.color};` : undefined}
			xmlns="http://www.w3.org/2000/svg"
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M2 3h20" /><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" /><path d="m7 21 5-5 5 5" />
		</svg>
	{/if}
</div>

{#snippet statusDot()}
	<span
		class="rlc-dot"
		class:active={info.status === "active"}
		class:archived={info.status === "archived"}
		role="img"
		aria-label={statusLabel}
		title={statusLabel}
	></span>
{/snippet}

{#if hovering && hasCardBody}
	<!-- The name in serif, the status as a dot before the first line under
	     it, the note and description in the UI font, and the dates as a small
	     labelled list with intensity drawn as its stacked bars. -->
	<HoverCard color={info.color} style={cardStyle} bind:el={cardEl}>
		<span class="kairos-hover-card-name">
			{#if dotLine === "name"}{@render statusDot()}{/if}{info.name}
		</span>
		{#if info.note.trim() !== ""}
			<div class="kairos-hover-card-note">{@render statusDot()}{info.note}</div>
		{/if}
		{#if info.description.trim() !== ""}
			<div class="kairos-hover-card-desc">
				{#if dotLine === "description"}{@render statusDot()}{/if}{info.description}
			</div>
		{/if}
		{#if info.intensity || info.since !== null || rolledUp.length > 0}
			<dl class="kairos-hover-card-facts">
				{#if info.intensity}
					<dt>Intensity</dt>
					<dd>
						<span
							class="kairos-hover-card-bars"
							style={info.color ? `color: ${info.color};` : undefined}
						><IntensityBars level={info.intensity.level} /></span>
						<span class="kairos-hover-card-dim">({info.intensity.level})</span>
						<span>on {formatShortDate(info.intensity.on)}</span>
					</dd>
				{/if}
				{#if info.since !== null}
					<dt>{statusLabel}</dt>
					<dd>
						Since {formatShortDate(info.since)}{#if info.until !== null}<span class="kairos-hover-card-dim">&nbsp;· until {formatShortDate(info.until)}</span>{/if}
					</dd>
				{/if}
				{#if rolledUp.length > 0}
					<dt>Also here</dt>
					<dd>{rolledUpText}</dd>
				{/if}
			</dl>
		{/if}
	</HoverCard>
{/if}

<style>
	.row-label {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		min-width: 0;
		width: 100%;
	}

	.row-label-text {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}

	/* Name and intensity bars share the first line; the name gives way first. */
	.row-label-line {
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		min-width: 0;
	}
	.row-label-pips {
		display: inline-flex;
		flex-shrink: 0;
		/* currentColor is the row's accent, set inline; faint without one. */
		color: var(--text-faint);
		/* About the height of the name beside it. */
		--intensity-bar-width: 12px;
		--intensity-bar-height: 3px;
		--intensity-bar-row: 5px;
	}

	.row-label-name {
		max-width: 100%;
		font-family: var(--kairos-font-serif);
		font-size: 13px;
		font-weight: 400;
		line-height: 1.3;
		color: var(--text-normal);
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Domains sit above their projects, so their name reads a touch larger. */
	.domain .row-label-name {
		font-size: 15px;
	}

	/* Wraps to a second line before it's cut; the full text is on hover. */
	.row-label-note {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		max-width: 100%;
		font-size: 10px;
		line-height: 1.3;
		color: var(--text-muted);
		text-align: left;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.row-label-rollup {
		color: var(--text-faint);
	}

	.row-label-icon {
		flex-shrink: 0;
		margin-top: 1px;
		/* Falls back to faint when no domain color is set. */
		color: var(--text-faint);
	}

	/* The status dot in the hover card (HoverCard). */
	.rlc-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		margin-right: 6px;
		border-radius: 50%;
		vertical-align: 0.15em;
		background: var(--text-faint);
	}
	.rlc-dot.active {
		background: var(--color-green);
	}
	.rlc-dot.archived {
		background: var(--color-red);
	}
</style>
