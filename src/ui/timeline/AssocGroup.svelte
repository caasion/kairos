<script lang="ts">
	// PROTOTYPE: one association's rows in a grouped list (groupByAssoc.ts), in
	// Kairos's own look: a bar in the domain color down the group's left edge,
	// like a block on the timeline, the name in serif, and on the right the
	// project (folder) or domain icon beside the count. Ctrl/Cmd+click on the
	// name opens the project or domain.

	import type { Snippet } from "svelte";
	import type { Association } from "../../types";
	import type { ResolvedAssociation } from "../../association";

	interface Props {
		/** Undefined for the "No project" group. */
		assoc?: Association;
		resolved?: ResolvedAssociation;
		count: number;
		onNavigate?: (assoc: Association) => void;
		children: Snippet;
	}

	let { assoc, resolved, count, onNavigate, children }: Props = $props();

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

<div class="ag" class:none={!assoc} style:--ag-color={resolved?.color}>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="ag-head"
		class:is-linked={canNavigate}
		title={canNavigate ? "Ctrl+click to open" : undefined}
		onclick={click}
	>
		<span class="ag-name">{label}</span>
		<span class="ag-spacer"></span>
		{#if assoc?.kind === "domain"}
			<svg class="ag-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Domain"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
		{:else if assoc}
			<svg class="ag-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Project"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
		{/if}
		<span class="ag-count">{count}</span>
	</div>
	{@render children()}
</div>

<style>
	.ag {
		margin-top: 8px;
		padding-left: 6px;
		border-left: 3px solid var(--ag-color, var(--background-modifier-border));
	}

	.ag:first-child {
		margin-top: 4px;
	}

	.ag.none {
		border-left-style: dashed;
	}

	.ag-head {
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		padding: 0 4px 2px;
	}

	.ag-name {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: Georgia, "Times New Roman", serif;
		font-size: 13px;
		color: var(--text-normal);
	}

	.ag.none .ag-name {
		color: var(--text-muted);
	}

	.ag-spacer {
		flex: 1;
	}

	.ag-icon {
		flex-shrink: 0;
		color: var(--ag-color, var(--text-muted));
	}

	.ag-count {
		flex-shrink: 0;
		min-width: 1ch;
		text-align: right;
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.ag-head.is-linked {
		cursor: pointer;
	}

	.ag-head.is-linked:hover .ag-name {
		text-decoration: underline;
	}
</style>
