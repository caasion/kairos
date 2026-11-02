<script lang="ts">
	// An item's project or domain on its meta line (ItemRow's `meta`): the
	// kind's icon and the name. When `linked`, Ctrl/Cmd-click opens it.

	import type { Association } from "../../types";

	interface Props {
		association: Association;
		// The resolved display name, else the raw tag id.
		label: string;
		// Came from the block, not the item: drawn in italics.
		inherited?: boolean;
		linked?: boolean;
		onNavigate?: () => void;
	}

	let { association, label, inherited = false, linked = false, onNavigate }: Props = $props();

	function onclick(event: MouseEvent) {
		if ((event.ctrlKey || event.metaKey) && onNavigate) {
			event.stopPropagation();
			onNavigate();
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="kairos-meta"
	class:is-inherited={inherited}
	class:is-linked={linked}
	title={linked ? "Ctrl+click to open" : undefined}
	{onclick}
>
	<!-- Inline rather than setIcon: it's drawn on every task row. -->
	{#if association.kind === "domain"}
		<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
	{:else}
		<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
	{/if}
	<span class="kairos-meta-label">{label}</span>
</div>
