<script lang="ts">
	// PROTOTYPE: the header over one association's rows in a grouped Day view
	// list (groupByAssoc.ts). Icon + name in the domain color, then the count.
	// Ctrl/Cmd+click opens the project or domain, like the association line it
	// replaces.

	import type { Association } from "../../types";
	import type { ResolvedAssociation } from "../../association";

	interface Props {
		/** Undefined for the "No project" group. */
		assoc?: Association;
		resolved?: ResolvedAssociation;
		count: number;
		onNavigate?: (assoc: Association) => void;
	}

	let { assoc, resolved, count, onNavigate }: Props = $props();

	const label = $derived(assoc ? (resolved?.displayName || assoc.id) : "No project");
	const canNavigate = $derived(!!(assoc && resolved?.resolved && onNavigate));

	function click(event: MouseEvent) {
		if (!assoc || !onNavigate) return;
		if (event.ctrlKey || event.metaKey) {
			event.stopPropagation();
			onNavigate(assoc);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="ag-header"
	class:none={!assoc}
	class:is-linked={canNavigate}
	style:--ag-color={resolved?.color}
	title={canNavigate ? "Ctrl+click to open" : undefined}
	onclick={click}
>
	{#if assoc?.kind === "domain"}
		<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
	{:else if assoc}
		<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
	{/if}
	<span class="ag-label">{label}</span>
	<span class="ag-count">{count}</span>
</div>

<style>
	.ag-header {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		padding: 6px 4px 1px;
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-semibold);
		color: var(--ag-color, var(--text-muted));
	}

	.ag-header:first-child {
		padding-top: 2px;
	}

	.ag-header svg {
		flex-shrink: 0;
	}

	.ag-header.none {
		color: var(--text-faint);
	}

	.ag-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ag-count {
		flex-shrink: 0;
		font-weight: var(--font-normal);
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.ag-header.is-linked {
		cursor: pointer;
	}

	.ag-header.is-linked:hover .ag-label {
		text-decoration: underline;
	}
</style>
