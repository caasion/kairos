<script lang="ts">
	// A 0–5 intensity as three thin stacked bars, filled from the bottom (#73):
	// an odd level lights a bar and the even level above it dims the next one.
	// Drawn in currentColor, so the caller sets the colour. With `onpick`, each
	// bar is a click target: it lights the stack up to that bar, and clicking
	// the top lit bar again dims it. The click doesn't reach the element below.

	import { barFills, levelAfterClick } from "./intensityBars";

	let {
		level,
		onpick,
	}: { level: number | undefined; onpick?: (level: number | undefined) => void } = $props();

	const fills = $derived(barFills(level));

	function pick(e: MouseEvent, bar: number) {
		e.stopPropagation();
		onpick?.(levelAfterClick(level, bar));
	}
</script>

<span class="intensity-bars" class:pickable={onpick !== undefined}>
	{#each fills as fill, bar (bar)}
		{#if onpick}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="intensity-bar-row"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => pick(e, bar)}
			><span class="intensity-bar {fill}"></span></span>
		{:else}
			<span class="intensity-bar-row"><span class="intensity-bar {fill}"></span></span>
		{/if}
	{/each}
</span>

<style>
	/* Bottom bar first in the markup; column-reverse stacks it at the bottom. */
	.intensity-bars {
		display: inline-flex;
		flex-direction: column-reverse;
		flex-shrink: 0;
	}
	/* Each bar sits in a 4px row, so the click target is taller than the bar. */
	.intensity-bar-row {
		display: flex;
		align-items: center;
		height: 4px;
	}
	.pickable .intensity-bar-row {
		cursor: pointer;
	}
	.intensity-bar {
		width: 9px;
		height: 2px;
		border-radius: 1px;
	}
	/* Off is a neutral gray, not a faint tint, so it can't be mistaken for dim. */
	.intensity-bar.off {
		background: color-mix(in srgb, var(--text-faint) 45%, transparent);
	}
	.intensity-bar.dim {
		background: color-mix(in srgb, currentColor 55%, transparent);
	}
	.intensity-bar.lit {
		background: currentColor;
	}
</style>
