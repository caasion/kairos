<script lang="ts">
	// A 0–5 intensity as three thin stacked bars, filled from the bottom, two
	// levels a bar (#73). Drawn in currentColor, so the caller sets the colour.
	// With `onpick`, each bar's left and right halves are click targets for its
	// odd and even level; the click doesn't reach the element underneath.

	import { barFills, levelAt } from "./intensityBars";

	let {
		level,
		onpick,
	}: { level: number | undefined; onpick?: (level: number) => void } = $props();

	const fills = $derived(barFills(level));

	function pick(e: MouseEvent, bar: number, half: "left" | "right") {
		e.stopPropagation();
		onpick?.(levelAt(bar, half));
	}
</script>

<span class="intensity-bars">
	{#each fills as fill, bar (bar)}
		<span class="intensity-bar-row">
			<span class="intensity-bar" class:half={fill === 0.5} class:full={fill === 1}></span>
			{#if onpick}
				{#each ["left", "right"] as const as half (half)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="intensity-bar-hit {half}"
						onpointerdown={(e) => e.stopPropagation()}
						onclick={(e) => pick(e, bar, half)}
					></span>
				{/each}
			{/if}
		</span>
	{/each}
</span>

<style>
	/* Bottom bar first in the markup; column-reverse stacks it at the bottom. */
	.intensity-bars {
		display: inline-flex;
		flex-direction: column-reverse;
		flex-shrink: 0;
	}
	/* Each bar sits in a 4px row, so the click halves are taller than the bar. */
	.intensity-bar-row {
		position: relative;
		display: flex;
		align-items: center;
		height: 4px;
	}
	.intensity-bar {
		width: 9px;
		height: 2px;
		border-radius: 1px;
		background: color-mix(in srgb, currentColor 25%, transparent);
	}
	.intensity-bar.full {
		background: currentColor;
	}
	.intensity-bar.half {
		background: linear-gradient(
			90deg,
			currentColor 50%,
			color-mix(in srgb, currentColor 25%, transparent) 50%
		);
	}
	.intensity-bar-hit {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 50%;
		cursor: pointer;
	}
	.intensity-bar-hit.left {
		left: 0;
	}
	.intensity-bar-hit.right {
		right: 0;
	}
</style>
