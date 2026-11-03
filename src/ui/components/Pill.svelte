<script lang="ts">
	// A pill: a small framed button with an icon, an optional label and a
	// count, that opens a list. The Day view's tray pills, the day-header badges
	// in Week and Grid, the routines pill and the Backlog's filter all use it,
	// so they share one shape, one type size and one set of tones (DESIGN.md).
	//
	// `tone` says what the list is waiting on: "neutral", "warn" (a decision,
	// like the Inbox with leftovers) or "accent" (offered routines, a filter
	// that's on). `open` gives it the hover look while its list is showing,
	// `pressed` marks a list toggled into the view, and `dropTarget` a drag
	// that's over it.
	//
	// The component that owns the list wires up the events and aria; the pill
	// passes them through to its <button>. Name a pill that opens a popover
	// with `hiddenLabel`, not `aria-label`, which Obsidian shows as a tooltip
	// over the popover.

	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { icon as drawIcon } from "../actions/icon";

	interface Props extends Omit<HTMLButtonAttributes, "children" | "class"> {
		/** An Obsidian icon name, or a snippet for one Obsidian doesn't have. */
		icon?: string | Snippet;
		label?: string;
		count?: number;
		/** The pill's name for screen readers, when the visible text isn't enough. */
		hiddenLabel?: string;
		tone?: "neutral" | "warn" | "accent";
		/** "s" (the default) for day headers, "m" for the Day view's tray and view headers. */
		size?: "s" | "m";
		/** Its list is showing: the hover look. */
		open?: boolean;
		/** Its list is toggled into the view, or its filter is on. */
		pressed?: boolean;
		/** A drag is over it. */
		dropTarget?: boolean;
		/** Extra classes, for a view that animates or places the pill. */
		class?: string;
		/** The <button>, for positioning a list under it. */
		el?: HTMLButtonElement;
		/** Anything after the count (a clear "×"). */
		children?: Snippet;
	}

	let {
		icon,
		label,
		count,
		hiddenLabel,
		tone = "neutral",
		size = "s",
		open = false,
		pressed = false,
		dropTarget = false,
		class: extra = "",
		el = $bindable(),
		children,
		...rest
	}: Props = $props();
</script>

<button
	{...rest}
	bind:this={el}
	class="kairos-pill {extra}"
	class:size-m={size === "m"}
	class:tone-warn={tone === "warn"}
	class:tone-accent={tone === "accent"}
	class:open
	class:pressed
	class:drop-target={dropTarget}
>
	{#if hiddenLabel}<span class="kairos-pill-hidden">{hiddenLabel}</span>{/if}
	{#if typeof icon === "string"}
		<span class="kairos-pill-icon" use:drawIcon={icon}></span>
	{:else if icon}
		{@render icon()}
	{/if}
	{#if label}<span class="kairos-pill-label">{label}</span>{/if}
	{#if count !== undefined}<span class="kairos-count">{count}</span>{/if}
	{@render children?.()}
</button>

<style>
	.kairos-pill {
		/* The tone's colour; neutral uses Obsidian's own border and text. */
		--pill-tone: var(--text-muted);
		--icon-size: var(--icon-xs);
		display: inline-flex;
		align-items: center;
		gap: var(--size-2-2);
		flex-shrink: 0;
		height: 18px;
		padding: 0 var(--size-2-3);
		border-radius: var(--kairos-radius-m);
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		box-shadow: none;
		color: var(--text-muted);
		font-size: var(--kairos-text-label);
		font-weight: var(--font-normal);
		white-space: nowrap;
		cursor: pointer;
	}
	.kairos-pill.size-m {
		height: 22px;
	}

	.kairos-pill:hover,
	.kairos-pill.open {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.kairos-pill.tone-warn {
		--pill-tone: var(--color-orange);
	}
	.kairos-pill.tone-accent {
		--pill-tone: var(--interactive-accent);
	}
	.kairos-pill.tone-warn,
	.kairos-pill.tone-accent {
		border-color: color-mix(in srgb, var(--pill-tone) 45%, transparent);
		background: color-mix(in srgb, var(--pill-tone) 12%, var(--background-primary));
		color: var(--pill-tone);
	}
	.kairos-pill.tone-warn:hover,
	.kairos-pill.tone-warn.open,
	.kairos-pill.tone-accent:hover,
	.kairos-pill.tone-accent.open {
		background: color-mix(in srgb, var(--pill-tone) 22%, var(--background-primary));
		color: var(--pill-tone);
	}

	/* A list in the view, or a drag over it, outranks the tone and the hover. */
	.kairos-pill.pressed,
	.kairos-pill.pressed:hover {
		border-color: color-mix(in srgb, var(--interactive-accent) 50%, var(--background-modifier-border));
		background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary));
		color: var(--text-normal);
	}
	.kairos-pill.drop-target,
	.kairos-pill.drop-target:hover {
		border-color: var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 12%, var(--background-primary));
		color: var(--text-normal);
	}

	.kairos-pill-icon {
		display: flex;
	}

	.kairos-pill-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
