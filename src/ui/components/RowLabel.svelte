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

	import type { ISODate } from "../../types";
	import type { RowLabelInfo } from "./rowLabel";
	import Portal from "./Portal.svelte";
	import IntensityBars from "./IntensityBars.svelte";

	let { info }: { info: RowLabelInfo } = $props();

	// ── Hover card ──
	let hovering = $state(false);
	let anchorEl = $state<HTMLElement>();
	let cardStyle = $state("left: -9999px; top: -9999px;");
	let cardEl = $state<HTMLElement>();

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

	function fmtDate(iso: ISODate): string {
		const [y, m, d] = iso.split("-");
		const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
		return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
	}

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
			<span class="row-label-note row-label-rollup">+ {rolledUpText}</span>
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
	<Portal>
		<!-- PROTOTYPE: the card in Kairos's own type — a full-height bar in the
		     entity's color, the name in serif, the status as a dot before the
		     first line under it, the note and description in the UI font, and the dates as a small
		     labelled list with intensity drawn as its stacked bars. -->
		<div class="row-label-card" bind:this={cardEl} style={cardStyle}>
			<span
				class="rlc-accent"
				style={info.color ? `background: ${info.color};` : undefined}
			></span>
			<div class="rlc-body">
				<span class="rlc-name">
					{#if dotLine === "name"}{@render statusDot()}{/if}{info.name}
				</span>
				{#if info.note.trim() !== ""}
					<div class="rlc-note">{@render statusDot()}{info.note}</div>
				{/if}
				{#if info.description.trim() !== ""}
					<div class="rlc-desc">
						{#if dotLine === "description"}{@render statusDot()}{/if}{info.description}
					</div>
				{/if}
				{#if info.intensity || info.since !== null || rolledUp.length > 0}
					<dl class="rlc-facts">
						{#if info.intensity}
							<dt>Intensity</dt>
							<dd>
								<span
									class="rlc-bars"
									style={info.color ? `color: ${info.color};` : undefined}
								><IntensityBars level={info.intensity.level} /></span>
								<span class="rlc-dim">({info.intensity.level})</span>
								<span>on {fmtDate(info.intensity.on)}</span>
							</dd>
						{/if}
						{#if info.since !== null}
							<dt>{statusLabel}</dt>
							<dd>
								Since {fmtDate(info.since)}{#if info.until !== null}<span class="rlc-dim">&nbsp;· until {fmtDate(info.until)}</span>{/if}
							</dd>
						{/if}
						{#if rolledUp.length > 0}
							<dt>Also here</dt>
							<dd>{rolledUpText}</dd>
						{/if}
					</dl>
				{/if}
			</div>
		</div>
	</Portal>
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
	}

	.row-label-name {
		max-width: 100%;
		font-family: Georgia, "Times New Roman", serif;
		font-size: 13px;
		font-weight: 400;
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

	.row-label-note {
		max-width: 100%;
		font-size: 10px;
		color: var(--text-muted);
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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

	/* ── Hover card (PROTOTYPE: Kairos style) ── */
	:global(.row-label-card) {
		position: fixed;
		z-index: var(--layer-popover);
		min-width: 180px;
		max-width: 270px;
		height: auto;
		display: flex;
		overflow: hidden;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-s);
		box-shadow: var(--shadow-s);
		pointer-events: none;
	}
	/* Full-height bar in the entity's color (faint when none is set). */
	:global(.row-label-card) .rlc-accent {
		width: 4px;
		flex-shrink: 0;
		background: var(--text-faint);
	}
	:global(.row-label-card) .rlc-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: 12px 14px;
	}
	:global(.row-label-card) .rlc-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		margin-right: 6px;
		border-radius: 50%;
		vertical-align: 0.15em;
		background: var(--text-faint);
	}
	:global(.row-label-card) .rlc-dot.active {
		background: var(--color-green);
	}
	:global(.row-label-card) .rlc-dot.archived {
		background: var(--color-red);
	}
	:global(.row-label-card) .rlc-name {
		margin: 1px 0 6px;
		font-family: Georgia, "Times New Roman", serif;
		font-size: 18px;
		font-weight: 400;
		line-height: 1.2;
		color: var(--text-normal);
	}
	:global(.row-label-card) .rlc-note {
		font-size: var(--font-ui-small);
		color: var(--text-normal);
		line-height: var(--line-height-tight);
	}
	:global(.row-label-card) .rlc-desc {
		margin-top: 2px;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		line-height: var(--line-height-tight);
	}
	:global(.row-label-card) .rlc-facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 5px 12px;
		align-items: center;
		margin: 10px 0 0;
		padding-top: 8px;
		border-top: 1px solid var(--background-modifier-border);
		font-size: var(--font-ui-smaller);
		font-variant-numeric: tabular-nums;
	}
	:global(.row-label-card) .rlc-facts dt {
		color: var(--text-muted);
	}
	:global(.row-label-card) .rlc-facts dd {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		color: var(--text-normal);
	}
	:global(.row-label-card) .rlc-bars {
		display: inline-flex;
		color: var(--text-muted);
	}
	:global(.row-label-card) .rlc-dim {
		color: var(--text-faint);
	}
</style>
