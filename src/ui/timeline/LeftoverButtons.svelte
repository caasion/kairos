<script lang="ts">
	// The two answers to a list of leftovers, as icons: leave the
	// rest (a list struck through) and bring all (arrows stacked like the
	// rows they move). The same pair heads the Day banner and the Week and
	// Grid Inbox lists. Obsidian shows each aria-label as its tooltip.

	interface Props {
		onLeave: () => void;
		onBringAll: () => void;
	}

	let { onLeave, onBringAll }: Props = $props();
</script>

<!-- One group, no gap between the two, like Obsidian's header buttons. -->
<span class="lo-icon-group">
<button
	class="lo-icon-btn"
	aria-label="Leave the rest"
	onclick={(e) => {
		e.stopPropagation();
		onLeave();
	}}
>
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 12H3"/><path d="M16 6H3"/><path d="M11 18H3"/><path d="m15.5 10.5 5 5"/><path d="m20.5 10.5-5 5"/></svg>
</button>
<button
	class="lo-icon-btn is-primary"
	aria-label="Bring all"
	onclick={(e) => {
		e.stopPropagation();
		onBringAll();
	}}
>
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h14"/><path d="m15 2 3 3-3 3"/><path d="M4 12h14"/><path d="m15 9 3 3-3 3"/><path d="M4 19h14"/><path d="m15 16 3 3-3 3"/></svg>
</button>
</span>

<style>
	.lo-icon-group {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		gap: 0;
		/* The icons' padding is their own gap from the text before them. */
		margin-right: calc(-1 * var(--size-2-2));
	}
	/* Frameless like Obsidian's header icons, with a fill on hover. */
	.lo-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: auto;
		padding: var(--size-2-1);
		border: none;
		border-radius: var(--clickable-icon-radius);
		background: transparent;
		box-shadow: none;
		color: var(--icon-color);
		cursor: pointer;
	}
	.lo-icon-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--icon-color-hover);
	}
	/* Bringing them over is the usual answer, so it carries the accent. */
	.lo-icon-btn.is-primary {
		color: var(--interactive-accent);
	}
	.lo-icon-btn svg {
		width: var(--icon-s);
		height: var(--icon-s);
	}
</style>
