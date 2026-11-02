<script lang="ts">
	// The status history to scale, drawn as the Timeline draws a row: each
	// active stretch a bar in the project's or domain's colour (SpanBar), shaded
	// by intensity, with its intention inside; inactive and archived time is the
	// gap between bars. A diamond under each change, in the colour of the
	// status it changed to (green active, faint inactive, red archived).
	//
	// Selecting a bar starts editing its intention in the list below
	// (StatusHistory), a diamond its reason. The intensity bars on a bar pick a
	// level, as on the Timeline.

	import type { ISODate, LifecycleState } from "../../types";
	import { dateFromISO } from "../../dayNote";
	import SpanBar from "../components/SpanBar.svelte";
	import type { StripPart } from "./statusStretches";

	interface Props {
		parts: StripPart[];
		color: string;
		/** The part being edited, to mark here. */
		marked: { part: "stretch" | "transition"; date: ISODate } | null;
		onSelect: (part: "stretch" | "transition", date: ISODate) => void;
		onPickIntensity: (date: ISODate, level: number | undefined) => void;
		readonly: boolean;
	}

	let { parts, color, marked, onSelect, onPickIntensity, readonly }: Props = $props();

	const STATUS_LABEL: Record<LifecycleState, string> = {
		active: "Active",
		inactive: "Inactive",
		archived: "Archived",
	};

	// A bar narrower than this shows neither its intensity nor its intention.
	const ROOMY_PX = 48;
	let trackWidth = $state(0);

	function formatDate(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}
</script>

<div class="kairos-strip" class:is-readonly={readonly}>
	<div class="kairos-strip-track" bind:clientWidth={trackWidth}>
		{#each parts as p (p.stretch.start)}
			{@const s = p.stretch}
			{#if s.rec.status === "active"}
				<div
					class="kairos-strip-bar"
					class:is-future={s.future}
					style:left={`${p.left * 100}%`}
					style:width={`${p.width * 100}%`}
				>
					<SpanBar
						{color}
						intensity={s.rec.intensity}
						openEnded={!s.end && !s.future}
						selected={marked?.part === "stretch" && marked.date === s.start}
						label={s.rec.note ?? ""}
						placeholder="No intention"
						roomy={p.width * trackWidth >= ROOMY_PX}
						ariaLabel={`Active from ${formatDate(s.start)}`}
						onpick={readonly ? undefined : (level: number | undefined) => onPickIntensity(s.start, level)}
						onclick={() => onSelect("stretch", s.start)}
					/>
				</div>
			{/if}
		{/each}
	</div>
	<div class="kairos-strip-marks">
		{#each parts as p (p.stretch.start)}
			{@const s = p.stretch}
			<div
				class="kairos-strip-mark"
				class:is-marked={marked?.part === "transition" && marked.date === s.start}
				data-status={s.rec.status}
				style:left={`${p.left * 100}%`}
				role="button"
				tabindex={readonly ? -1 : 0}
				aria-label={`Changed to ${STATUS_LABEL[s.rec.status].toLowerCase()} on ${formatDate(s.start)}`}
				onclick={() => onSelect("transition", s.start)}
				onkeydown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onSelect("transition", s.start);
					}
				}}
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
		display: flex;
		flex-direction: column;
		gap: var(--size-2-2);
		/* Room for the diamonds at the ends and the running bar's arrow. */
		padding-inline: var(--size-4-1) var(--size-4-3);
	}
	.kairos-strip.is-readonly {
		pointer-events: none;
	}
	/* A Timeline row: a hairline down the middle where nothing is active. */
	.kairos-strip-track {
		position: relative;
		height: var(--size-4-6);
	}
	.kairos-strip-track::before {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		border-top: var(--border-width) dashed var(--background-modifier-border);
	}
	.kairos-strip-bar {
		position: absolute;
		top: 0;
		bottom: 0;
		min-width: var(--size-2-3);
	}
	.kairos-strip-bar.is-future {
		opacity: 0.6;
	}
	.kairos-strip-marks {
		position: relative;
		height: var(--size-4-2);
	}
	[data-status="active"] {
		--kairos-strip-mark: var(--color-green);
	}
	[data-status="inactive"] {
		--kairos-strip-mark: var(--text-faint);
	}
	[data-status="archived"] {
		--kairos-strip-mark: var(--color-red);
	}
	/* A diamond under each change, in the colour it changed to. */
	.kairos-strip-mark {
		position: absolute;
		top: 0;
		width: var(--size-4-2);
		height: var(--size-4-2);
		transform: translateX(-50%) rotate(45deg) scale(0.75);
		background: var(--kairos-strip-mark);
		cursor: pointer;
	}
	.kairos-strip-mark:hover {
		filter: brightness(1.2);
	}
	.kairos-strip-mark.is-marked {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
	}
	.kairos-strip-axis {
		display: flex;
		justify-content: space-between;
		color: var(--text-faint);
		font-size: var(--kairos-text-meta);
		font-variant-numeric: tabular-nums;
	}
</style>
