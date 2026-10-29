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

<!-- One SVG with crisp edges, so every bar snaps to whole pixels and the three
     come out the same height wherever the stack lands. Bar 0 is the bottom. -->
<svg class="intensity-bars" class:pickable={onpick !== undefined} aria-hidden="true">
	{#each fills as fill, bar (bar)}
		<g style:--slot={fills.length - 1 - bar}>
			<rect class="intensity-bar {fill}"></rect>
			{#if onpick}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<rect
					class="intensity-bar-hit"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => pick(e, bar)}
				></rect>
			{/if}
		</g>
	{/each}
</svg>

<style>
	/* Sized by --intensity-bar-width/-height/-row so a host can scale the icon;
	   the defaults suit a line of text. Each bar sits centred in a row taller
	   than itself, and the whole row is its click target. */
	.intensity-bars {
		display: inline-block;
		flex-shrink: 0;
		width: var(--intensity-bar-width, 9px);
		height: calc(3 * var(--intensity-bar-row, 4px));
		shape-rendering: crispEdges;
		overflow: visible;
	}
	.intensity-bar,
	.intensity-bar-hit {
		x: 0;
		width: 100%;
	}
	.intensity-bar {
		y: calc(
			var(--slot) * var(--intensity-bar-row, 4px) +
				(var(--intensity-bar-row, 4px) - var(--intensity-bar-height, 2px)) / 2
		);
		height: var(--intensity-bar-height, 2px);
	}
	.intensity-bar-hit {
		y: calc(var(--slot) * var(--intensity-bar-row, 4px));
		height: var(--intensity-bar-row, 4px);
		fill: transparent;
	}
	.pickable .intensity-bar-hit {
		cursor: pointer;
	}
	/* Off is a neutral gray, not a faint tint, so it can't be mistaken for dim. */
	.intensity-bar.off {
		fill: color-mix(in srgb, var(--text-faint) 45%, transparent);
	}
	.intensity-bar.dim {
		fill: color-mix(in srgb, currentColor 55%, transparent);
	}
	.intensity-bar.lit {
		fill: currentColor;
	}
</style>
