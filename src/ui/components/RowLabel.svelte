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
				{#if info.color}
					<span class="rlc-dot" style={`background: ${info.color};`}></span>
				{/if}
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
					{#if info.status === "active"}Active{:else}{statusLabel}{/if}
					since {fmtDate(info.since)}
					{#if info.until !== null}· until {fmtDate(info.until)}{:else}· ongoing{/if}
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
		z-index: 1000;
		min-width: 160px;
		max-width: 260px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: var(--shadow-l);
		padding: 8px 10px;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	:global(.row-label-card) .rlc-head {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	:global(.row-label-card) .rlc-dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		flex-shrink: 0;
	}
	:global(.row-label-card) .rlc-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-normal);
	}
	:global(.row-label-card) .rlc-desc {
		font-size: 12px;
		color: var(--text-muted);
		line-height: 1.4;
	}
	:global(.row-label-card) .rlc-status {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	:global(.row-label-card) .rlc-status-badge {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		padding: 1px 6px;
		border-radius: 4px;
		color: var(--text-on-accent);
		background: var(--text-faint);
	}
	:global(.row-label-card) .rlc-status-badge.active {
		background: var(--color-green, #4caf50);
	}
	:global(.row-label-card) .rlc-status-badge.inactive {
		background: var(--text-muted);
	}
	:global(.row-label-card) .rlc-status-badge.archived {
		background: var(--color-red, #e5534b);
	}
	:global(.row-label-card) .rlc-status-note {
		font-size: 12px;
		color: var(--text-normal);
	}
	:global(.row-label-card) .rlc-span {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
</style>
