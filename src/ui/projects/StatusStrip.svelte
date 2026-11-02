<script lang="ts">
	// The status history to scale: one bar from the first record to today, a
	// stretch per status in its colour (green active, shaded by intensity;
	// faint inactive; red archived; striped when scheduled), and a diamond
	// under each change. Selecting a stretch or a diamond opens that part for
	// editing in the list below (StatusHistory).

	import type { ISODate, LifecycleState } from "../../types";
	import { dateFromISO } from "../../dayNote";
	import { INTENSITY_MAX } from "../../projectFile";
	import type { StripPart } from "./statusStretches";

	interface Props {
		parts: StripPart[];
		/** The part open for editing, to mark here. */
		open: { part: "stretch" | "transition"; date: ISODate } | null;
		onSelect: (part: "stretch" | "transition", date: ISODate) => void;
		readonly: boolean;
	}

	let { parts, open, onSelect, readonly }: Props = $props();

	const STATUS_LABEL: Record<LifecycleState, string> = {
		active: "Active",
		inactive: "Inactive",
		archived: "Archived",
	};

	function formatDate(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	// An active stretch's fill deepens with its intensity; unset reads as most.
	function level(intensity: number | undefined): number {
		return intensity === undefined ? 0.85 : 0.35 + (0.65 * intensity) / INTENSITY_MAX;
	}

	function keys(e: KeyboardEvent, part: "stretch" | "transition", date: ISODate) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onSelect(part, date);
		}
	}
</script>

<div class="kairos-strip" class:is-readonly={readonly}>
	<div class="kairos-strip-bar">
		{#each parts as p (p.stretch.start)}
			{@const s = p.stretch}
			<div
				class="kairos-strip-part"
				class:is-future={s.future}
				class:is-open={open?.part === "stretch" && open.date === s.start}
				data-status={s.rec.status}
				style:left={`${p.left * 100}%`}
				style:width={`${p.width * 100}%`}
				style:--kairos-strip-level={level(s.rec.intensity)}
				role="button"
				tabindex={readonly ? -1 : 0}
				aria-label={`${STATUS_LABEL[s.rec.status]} from ${formatDate(s.start)}`}
				onclick={() => onSelect("stretch", s.start)}
				onkeydown={(e) => keys(e, "stretch", s.start)}
			></div>
		{/each}
	</div>
	<div class="kairos-strip-marks">
		{#each parts as p (p.stretch.start)}
			{@const s = p.stretch}
			<div
				class="kairos-strip-mark"
				class:is-open={open?.part === "transition" && open.date === s.start}
				data-status={s.rec.status}
				style:left={`${p.left * 100}%`}
				role="button"
				tabindex={readonly ? -1 : 0}
				aria-label={`Changed to ${STATUS_LABEL[s.rec.status].toLowerCase()} on ${formatDate(s.start)}`}
				onclick={() => onSelect("transition", s.start)}
				onkeydown={(e) => keys(e, "transition", s.start)}
			></div>
		{/each}
	</div>
	{#if parts[0]}
		<div class="kairos-strip-axis">
			<span>{formatDate(parts[0].stretch.start)}</span>
			<span>Today</span>
		</div>
	{/if}
</div>

<style>
	.kairos-strip {
		--kairos-strip-height: var(--size-4-3);
		display: flex;
		flex-direction: column;
		gap: var(--size-2-1);
		/* Room for the first and last diamonds to sit over the ends. */
		padding-inline: var(--size-4-1);
	}
	.kairos-strip-bar {
		position: relative;
		height: var(--kairos-strip-height);
		border-radius: var(--kairos-radius-s);
		background: var(--background-modifier-border);
	}
	.kairos-strip-part,
	.kairos-strip-mark {
		position: absolute;
		cursor: pointer;
	}
	.kairos-strip.is-readonly :is(.kairos-strip-part, .kairos-strip-mark) {
		pointer-events: none;
	}
	.kairos-strip-part {
		top: 0;
		bottom: 0;
		min-width: var(--size-2-1);
		/* A hairline of the page between stretches, so neighbours read apart. */
		box-shadow: inset calc(-1 * var(--border-width)) 0 0 var(--background-primary);
		background: var(--kairos-strip-color);
	}
	.kairos-strip-part:first-child {
		border-radius: var(--kairos-radius-s) 0 0 var(--kairos-radius-s);
	}
	.kairos-strip-part:last-child {
		border-radius: 0 var(--kairos-radius-s) var(--kairos-radius-s) 0;
	}
	.kairos-strip-part:hover,
	.kairos-strip-mark:hover {
		filter: brightness(1.2);
	}
	.kairos-strip-part.is-future {
		background: repeating-linear-gradient(
			-45deg,
			var(--kairos-strip-color) 0 var(--size-2-1),
			transparent var(--size-2-1) var(--size-2-3)
		);
	}
	.kairos-strip-part.is-open,
	.kairos-strip-mark.is-open {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
		z-index: 1;
	}
	[data-status="active"] {
		--kairos-strip-color: rgba(var(--color-green-rgb), var(--kairos-strip-level, 0.85));
	}
	[data-status="inactive"] {
		--kairos-strip-color: var(--text-faint);
	}
	[data-status="archived"] {
		--kairos-strip-color: rgba(var(--color-red-rgb), 0.7);
	}
	.kairos-strip-marks {
		position: relative;
		height: var(--size-4-2);
	}
	/* A diamond under each change, in the colour it changed to. */
	.kairos-strip-mark {
		top: 0;
		width: var(--size-4-2);
		height: var(--size-4-2);
		transform: translateX(-50%) rotate(45deg) scale(0.75);
		background: var(--kairos-strip-color);
	}
	.kairos-strip-axis {
		display: flex;
		justify-content: space-between;
		color: var(--text-faint);
		font-size: var(--font-ui-smaller);
		font-variant-numeric: tabular-nums;
	}
</style>
