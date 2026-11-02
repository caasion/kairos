<script lang="ts">
	// The arrows around a header's date: « ‹ date › ». The outer pair takes the
	// view's big step (a window, a month), the inner pair one smaller unit (a
	// day, a week), so you can walk a long range without jumping past what you
	// wanted. Every view's date navigator is built from this, so they all look
	// and step alike (DESIGN.md).
	//
	// `big` and `small` name the step for the tooltip, as "a week" or "7 days";
	// the arrows say "Back a week" / "Forward a week". Leave out `big` for just
	// the inner pair, where a narrow header can't spare the room (Day).

	import type { Snippet } from "svelte";
	import IconButton from "./IconButton.svelte";

	interface Props {
		big?: string;
		small: string;
		onstep: (dir: 1 | -1, big: boolean) => void;
		/** The date button between the arrows. */
		children: Snippet;
	}

	let { big, small, onstep, children }: Props = $props();
</script>

{#if big}
	<IconButton size="m" icon="chevrons-left" label={`Back ${big}`} onclick={() => onstep(-1, true)} />
{/if}
<IconButton size="m" icon="chevron-left" label={`Back ${small}`} onclick={() => onstep(-1, false)} />
{@render children()}
<IconButton size="m" icon="chevron-right" label={`Forward ${small}`} onclick={() => onstep(1, false)} />
{#if big}
	<IconButton size="m" icon="chevrons-right" label={`Forward ${big}`} onclick={() => onstep(1, true)} />
{/if}
