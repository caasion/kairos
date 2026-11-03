<script lang="ts">
	// A stretch of active time drawn as the Timeline draws it: thick caps in the
	// project's or domain's colour at each end, a hairline top and bottom, and
	// the inside tinted in proportion to its intensity, so an unrated stretch
	// is a plain frame and intensity 0 a dashed one. A stretch that's still
	// running has no right cap and an arrow instead. The intention sits inside.
	// It fills its parent; the parent places it.
	//
	// Used by the status strip in the Projects view. The Timeline's own bars
	// (GanttView) are the next to move onto it (DESIGN.md, Next).

	import IntensityBars from "./IntensityBars.svelte";

	interface Props {
		color: string;
		intensity: number | undefined;
		/** Still running: no right cap, an arrow. */
		openEnded?: boolean;
		selected?: boolean;
		/** The intention; the placeholder shows when it's empty. */
		label?: string;
		placeholder?: string;
		/** Room for the intensity bars and the label (a thin bar shows neither). */
		roomy?: boolean;
		/** Makes the intensity bars a picker, as on the Timeline. */
		onpick?: (level: number | undefined) => void;
		onclick?: (event: MouseEvent) => void;
		ariaLabel?: string;
	}

	let {
		color,
		intensity,
		openEnded = false,
		selected = false,
		label = "",
		placeholder = "",
		roomy = true,
		onpick,
		onclick,
		ariaLabel,
	}: Props = $props();
</script>

<div
	class="kairos-span-bar"
	class:open-ended={openEnded}
	class:selected
	class:dormant={intensity === 0}
	class:unrated={intensity === undefined}
	style:--kairos-span-color={color}
	style:--kairos-span-fill={`${(intensity ?? 0) * 10}%`}
	role="button"
	tabindex="0"
	aria-label={ariaLabel}
	onclick={(e) => onclick?.(e)}
	onkeydown={(e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			(e.currentTarget as HTMLElement).click();
		}
	}}
>
	{#if roomy}
		<span class="kairos-span-pips"><IntensityBars level={intensity} {onpick} /></span>
		<span class="kairos-span-label" class:placeholder={!label}>{label || placeholder}</span>
	{/if}
</div>

<style>
	.kairos-span-bar {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		overflow: visible;
		cursor: pointer;
		border-radius: var(--kairos-radius-m);
		border: var(--border-width) solid color-mix(in srgb, var(--kairos-span-color) 45%, transparent);
		border-left: var(--kairos-accent-width) solid var(--kairos-span-color);
		border-right: var(--kairos-accent-width) solid var(--kairos-span-color);
		background: color-mix(
			in srgb,
			var(--kairos-span-color) var(--kairos-span-fill),
			var(--background-primary)
		);
	}
	.kairos-span-bar.dormant {
		border-style: dashed;
	}
	.kairos-span-bar:hover {
		border-color: color-mix(in srgb, var(--kairos-span-color) 70%, transparent);
		border-left-color: var(--kairos-span-color);
		border-right-color: var(--kairos-span-color);
	}
	/* Still running: no right cap, an arrow that says it continues. */
	.kairos-span-bar.open-ended {
		border-right: none;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.kairos-span-bar.open-ended::after {
		content: "";
		position: absolute;
		top: calc(-1 * var(--border-width));
		bottom: calc(-1 * var(--border-width));
		right: calc(-1 * var(--size-4-2));
		width: var(--size-4-2);
		background: var(--kairos-span-color);
		clip-path: polygon(0 0, 100% 50%, 0 100%);
	}
	.kairos-span-bar.selected {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
		z-index: 2;
	}
	.kairos-span-pips {
		display: flex;
		flex-shrink: 0;
		padding-left: var(--size-4-1);
		color: var(--kairos-span-color);
	}
	/* Unrated: the bars show on hover, as the way to rate it. */
	.kairos-span-bar.unrated .kairos-span-pips {
		visibility: hidden;
	}
	.kairos-span-bar.unrated:is(:hover, .selected) .kairos-span-pips {
		visibility: visible;
		opacity: 0.6;
	}
	.kairos-span-label {
		flex: 1;
		min-width: 0;
		padding: 0 var(--size-4-1) 0 var(--size-4-2);
		color: var(--text-normal);
		font-size: var(--kairos-text-label);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kairos-span-label.placeholder {
		color: var(--text-faint);
		font-style: italic;
	}
</style>
