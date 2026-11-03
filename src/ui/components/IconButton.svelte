<script lang="ts">
	// A frameless icon button, Obsidian's own: the `clickable-icon` class gives
	// it Obsidian's padding, corner, hover fill and colours, so it matches the
	// buttons in the tab header and the sidebars. Use it for every icon-only
	// button instead of styling a <button> by hand (DESIGN.md).
	//
	// `label` names the button for screen readers, and Obsidian shows it as the
	// tooltip. Pass `icon` for one of Obsidian's icons, or `children` for an
	// icon Obsidian doesn't have.

	import type { Snippet } from "svelte";
	import { icon as drawIcon } from "../actions/icon";

	interface Props {
		label: string;
		icon?: string;
		/** Shown as pressed (a toggle that's on). */
		pressed?: boolean;
		/** The usual action of a pair, in the accent colour. */
		primary?: boolean;
		/** "s" (the default) for rows and lists, "m" for headers. */
		size?: "s" | "m";
		disabled?: boolean;
		onclick: (event: MouseEvent) => void;
		children?: Snippet;
	}

	let {
		label,
		icon,
		pressed,
		primary = false,
		size = "s",
		disabled = false,
		onclick,
		children,
	}: Props = $props();
</script>

<button
	class="clickable-icon kairos-icon-button"
	class:is-active={pressed}
	class:is-primary={primary}
	class:size-m={size === "m"}
	aria-label={label}
	aria-pressed={pressed}
	{disabled}
	onclick={(e) => {
		e.stopPropagation();
		onclick(e);
	}}
>
	{#if icon}
		<span class="kairos-icon-button-glyph" use:drawIcon={icon}></span>
	{:else}
		{@render children?.()}
	{/if}
</button>

<style>
	/* Lists sit tighter than Obsidian's header, so the small size trims the
	   padding. The icon follows Obsidian's icon sizes. */
	.kairos-icon-button {
		--icon-size: var(--icon-s);
		flex-shrink: 0;
		padding: var(--size-2-1);
	}

	.kairos-icon-button.size-m {
		--icon-size: var(--icon-m);
		padding: var(--size-2-2) var(--size-2-3);
	}

	.kairos-icon-button.is-primary {
		color: var(--interactive-accent);
	}

	.kairos-icon-button-glyph {
		display: flex;
	}

	/* An icon passed as children sizes like one of Obsidian's. */
	.kairos-icon-button :global(svg) {
		width: var(--icon-size);
		height: var(--icon-size);
	}
</style>
