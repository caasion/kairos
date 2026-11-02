<script lang="ts">
	// Kairos's hover card: a full-height bar in the entity's colour beside a
	// body that reads the entity's name in serif, then whatever its owner puts
	// under it. RowLabel shows a project's status in one; the Grid's marks show
	// a new intention or intensity. It draws on Popover, so it's portaled and
	// fixed; the owner places it with `left`/`top` in `style` and decides when
	// it opens. It never takes the pointer, so it can't steal the hover that
	// opened it.
	//
	// The body's parts are global classes in styles.css (`kairos-hover-card-*`):
	// `-name`, `-note`, `-desc`, `-facts` (a <dl>), `-bars` and `-dim`.

	import type { Snippet } from "svelte";
	import Popover from "./Popover.svelte";

	let {
		color,
		style,
		el = $bindable(),
		children,
	}: {
		/** The entity's colour, for the bar (faint when unset). */
		color?: string;
		/** Where it goes: `left: …; top: …;`. */
		style: string;
		/** The card, for measuring before placing it. */
		el?: HTMLDivElement;
		children: Snippet;
	} = $props();
</script>

<Popover
	class="kairos-hover-card"
	surface="secondary"
	overflow="hidden"
	style="{style} pointer-events: none;"
	bind:el
>
	<span class="kairos-hover-card-accent" style:background={color}></span>
	<div class="kairos-hover-card-body">
		{@render children()}
	</div>
</Popover>
