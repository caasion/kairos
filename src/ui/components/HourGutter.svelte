<script lang="ts">
	// The hour labels down the left of a multi-day timeline ("07:00", "08:00"),
	// on the secondary background with a rule on its right. The Week view and
	// the Routines week share it; HourLines draws the matching lines across
	// the columns. Its header counterpart is `corner`: an
	// empty cell of the same width that carries the rule up through the
	// header row and rounds the strip's top-left corner.

	import { gridHeight, minutesToOffset, visibleHours, type TimelineGeometry } from "../timeline/layout";

	interface Props {
		geo: TimelineGeometry;
		/** The header row's empty corner cell instead of the labels. */
		corner?: boolean;
	}

	let { geo, corner = false }: Props = $props();
</script>

{#if corner}
	<div class="hour-gutter is-corner"></div>
{:else}
	<div class="hour-gutter" style:height="{gridHeight(geo)}px">
		{#each visibleHours(geo) as hour (hour)}
			<div class="hour-label" style:top="{minutesToOffset(hour * 60, geo)}px">
				{String(hour).padStart(2, "0")}:00
			</div>
		{/each}
	</div>
{/if}

<style>
	.hour-gutter {
		width: 46px;
		min-width: 46px;
		position: relative;
		border-right: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}
	.hour-gutter.is-corner {
		border-bottom: 1px solid var(--background-modifier-border);
		border-radius: var(--kairos-radius-l) 0 0 0;
	}
	.hour-label {
		position: absolute;
		right: var(--size-2-3);
		transform: translateY(-0.5em);
		font-size: var(--kairos-text-meta);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
