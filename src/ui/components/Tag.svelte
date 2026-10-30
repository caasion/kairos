<script lang="ts">
	// A tag: a short word in small capitals that marks a row's state, like a
	// project's "paused", a picker row's "inactive" or a status's "current".
	// It isn't a control; a framed thing you can press is a Pill (DESIGN.md).
	//
	// "neutral" is an outline in faint text; "accent" is filled, for the one
	// row in a list that's current.

	import type { Snippet } from "svelte";

	interface Props {
		tone?: "neutral" | "accent";
		children: Snippet;
	}

	let { tone = "neutral", children }: Props = $props();
</script>

<span class="kairos-tag" class:tone-accent={tone === "accent"}>{@render children()}</span>

<style>
	.kairos-tag {
		flex-shrink: 0;
		padding: 0 var(--size-2-2);
		border-radius: var(--kairos-radius-s);
		border: 1px solid var(--background-modifier-border);
		color: var(--text-faint);
		font-size: var(--kairos-text-meta);
		font-weight: var(--font-semibold);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.kairos-tag.tone-accent {
		border-color: var(--interactive-accent);
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}
</style>
