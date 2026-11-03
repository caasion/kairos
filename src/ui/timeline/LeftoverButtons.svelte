<script lang="ts">
	// The two answers to a list of leftovers, as icons: leave the rest (a list
	// struck through) and bring all (arrows stacked like the rows they move).
	// The same pair heads the Day banner and the Week and Grid Inbox lists.

	import IconButton from "../components/IconButton.svelte";

	interface Props {
		onLeave: () => void;
		onBringAll: () => void;
	}

	let { onLeave, onBringAll }: Props = $props();
</script>

<!-- One group, no gap between the two, like Obsidian's header buttons. -->
<span class="lo-icon-group">
	<IconButton label="Leave the rest" icon="list-x" onclick={onLeave} />
	<!-- Bringing them over is the usual answer, so it carries the accent. -->
	<IconButton label="Bring all" primary onclick={onBringAll}>
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h14"/><path d="m15 2 3 3-3 3"/><path d="M4 12h14"/><path d="m15 9 3 3-3 3"/><path d="M4 19h14"/><path d="m15 16 3 3-3 3"/></svg>
	</IconButton>
</span>

<style>
	.lo-icon-group {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		gap: 0;
		/* The icons' padding is their own gap from the text before them. */
		margin-right: calc(-1 * var(--size-2-1));
	}
</style>
