<script lang="ts">
	// A Grid/Gantt row label: the entity name, top-left aligned, with its status
	// note as a muted subline (hidden when empty) and — for domains — the domain
	// icon on the right, tinted the domain's color. Hovering the label opens a
	// portaled info card (description, status + note, active since/until) so the
	// full context is one hover away without cluttering the compact row.
	//
	// Purely presentational: it owns only the hover/popover state. The group
	// accent stripe is drawn by the parent (it spans multiple rows), not here.

	import type { ISODate } from "../../types";
	import type { RowLabelInfo } from "./rowLabel";
	import Portal from "./Portal.svelte";

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
	const hasCardBody = $derived(
		info.description.trim() !== "" || info.note.trim() !== "" || info.since !== null,
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
		<span class="row-label-name" title={info.name}>{info.name}</span>
		{#if info.note.trim() !== ""}
			<span class="row-label-note" title={info.note}>{info.note}</span>
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

{#if hovering && hasCardBody}
	<Portal>
		<div class="row-label-card" bind:this={cardEl} style={cardStyle}>
			<div class="rlc-head">
				<span
					class="rlc-accent"
					style={info.color ? `background: ${info.color};` : undefined}
				></span>
				<span class="rlc-name">{info.name}</span>
			</div>
			{#if info.description.trim() !== ""}
				<div class="rlc-desc">{info.description}</div>
			{/if}
			<div class="rlc-status">
				<span class="rlc-status-badge" class:active={info.status === "active"} class:inactive={info.status === "inactive"} class:archived={info.status === "archived"}>
					{statusLabel}
				</span>
				{#if info.note.trim() !== ""}
					<span class="rlc-status-note">{info.note}</span>
				{/if}
			</div>
			{#if info.since !== null}
				<div class="rlc-span">
					{statusLabel} since {fmtDate(info.since)}
					{#if info.until !== null}
						· until {fmtDate(info.until)}
					{:else if info.status === "active"}
						· ongoing
					{/if}
				</div>
			{/if}
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

	.row-label-icon {
		flex-shrink: 0;
		margin-top: 1px;
		/* Falls back to faint when no domain color is set. */
		color: var(--text-faint);
	}

	/* ── Hover card ── */
	:global(.row-label-card) {
		position: fixed;
		z-index: var(--layer-popover);
		min-width: 160px;
		max-width: 260px;
		height: auto;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
		padding: var(--size-4-2) var(--size-4-3);
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
	}
	:global(.row-label-card) .rlc-head {
		display: flex;
		align-items: stretch;
		gap: var(--size-4-2);
	}
	/* Vertical accent bar in the entity's color (faint when none is set). */
	:global(.row-label-card) .rlc-accent {
		width: 3px;
		border-radius: 2px;
		background: var(--text-faint);
		flex-shrink: 0;
	}
	:global(.row-label-card) .rlc-name {
		font-family: Georgia, "Times New Roman", serif;
		font-size: var(--font-ui-medium);
		font-weight: 400;
		color: var(--text-normal);
	}
	:global(.row-label-card) .rlc-desc {
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		line-height: var(--line-height-tight);
	}
	:global(.row-label-card) .rlc-status {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		flex-wrap: wrap;
	}
	/* Muted "chip": tinted 20% fill behind a full-opacity border and darker,
	   legible text — never bright-on-bright. */
	:global(.row-label-card) .rlc-status-badge {
		font-size: 0.7em;
		font-weight: var(--font-semibold);
		text-transform: capitalizee;
		letter-spacing: 0.5px;
		padding: 1px var(--size-4-2);
		border-radius: var(--radius-s);
		color: var(--text-muted);
		background: color-mix(in srgb, var(--text-faint) 20%, transparent);
		border: 1px solid var(--text-faint);
	}
	:global(.row-label-card) .rlc-status-badge.active {
		color: color-mix(in srgb, var(--color-green) 75%, var(--text-normal));
		background: color-mix(in srgb, var(--color-green) 20%, transparent);
		border-color: var(--color-green);
	}
	:global(.row-label-card) .rlc-status-badge.inactive {
		color: var(--text-muted);
		background: color-mix(in srgb, var(--text-muted) 20%, transparent);
		border-color: var(--text-muted);
	}
	:global(.row-label-card) .rlc-status-badge.archived {
		color: color-mix(in srgb, var(--color-red) 75%, var(--text-normal));
		background: color-mix(in srgb, var(--color-red) 20%, transparent);
		border-color: var(--color-red);
	}
	:global(.row-label-card) .rlc-status-note {
		font-size: var(--font-ui-smaller);
		color: var(--text-normal);
	}
	:global(.row-label-card) .rlc-span {
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
</style>
