<script lang="ts">
	// Faint hour lines across a multi-day timeline's columns, drawn once
	// behind them. Pairs with HourGutter.

	import { gridHeight, minutesToOffset, visibleHours, type TimelineGeometry } from "../timeline/layout";

	interface Props {
		geo: TimelineGeometry;
	}

	let { geo }: Props = $props();
</script>

<div class="hour-lines" style:height="{gridHeight(geo)}px">
	{#each visibleHours(geo) as hour (hour)}
		<div class="hour-line" style:top="{minutesToOffset(hour * 60, geo)}px"></div>
	{/each}
</div>

<style>
	.hour-lines {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		pointer-events: none;
		z-index: 0;
	}
	.hour-line {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--background-modifier-border);
		opacity: 0.5;
	}
</style>
