<script lang="ts">
	// The status history to scale, drawn as the Timeline draws a row: each
	// active stretch a bar in the project's or domain's colour (SpanBar), shaded
	// by intensity, with its intention inside; inactive and archived time is the
	// gap between bars. A diamond under each change, in the colour of the
	// status it changed to (green active, faint inactive, red archived).
	//
	// What you can do here follows decision 133, where a change owns its date
	// and its reason. A bar's ends are changes, so dragging either end, or a
	// diamond, moves that change's date, as dragging a bar's edge does on the
	// Timeline. It stops a day short of the changes either side, so the order
	// holds. Clicking a diamond starts on its reason in the list below
	// (StatusHistory); clicking a bar starts on its intention; its intensity
	// bars pick a level.

	import type { ISODate, LifecycleState, StatusRecord } from "../../types";
	import { dateFromISO } from "../../dayNote";
	import { shiftDays } from "../../gantt/ganttUtils";
	import SpanBar from "../components/SpanBar.svelte";
	import {
		changeBounds,
		clampChange,
		stretchesOf,
		stripOf,
		stripSpan,
		withChangeMoved,
	} from "./statusStretches";

	interface Props {
		history: StatusRecord[];
		today: ISODate;
		color: string;
		/** The part being edited, to mark here. */
		marked: { part: "stretch" | "transition"; date: ISODate } | null;
		onSelect: (part: "stretch" | "transition", date: ISODate) => void;
		onPickIntensity: (date: ISODate, level: number | undefined) => void;
		/** A change dragged to a new date. */
		onMoveChange: (from: ISODate, to: ISODate) => void;
		readonly: boolean;
	}

	let {
		history,
		today,
		color,
		marked,
		onSelect,
		onPickIntensity,
		onMoveChange,
		readonly,
	}: Props = $props();

	const STATUS_LABEL: Record<LifecycleState, string> = {
		active: "Active",
		inactive: "Inactive",
		archived: "Archived",
	};

	// A bar narrower than this shows neither its intensity nor its intention.
	const ROOMY_PX = 48;
	// A press that moves less than this is a click, not a drag.
	const DRAG_SLOP_PX = 3;
	let trackWidth = $state(0);

	// ── Dragging a change ──
	// The strip draws the history with the dragged change at its new date, so
	// the bars on both sides follow the pointer; it's written on release. The
	// listeners are on the window, since the dragged parts are redrawn under it.
	interface Drag {
		from: ISODate;
		to: ISODate;
		bounds: { min?: ISODate; max: ISODate };
		startX: number;
		pxPerDay: number;
		moved: boolean;
	}
	let drag = $state<Drag | null>(null);

	const shown = $derived(drag ? withChangeMoved(history, drag.from, drag.to) : history);
	const parts = $derived(stripOf(stretchesOf(shown, today), today));

	function beginDrag(e: PointerEvent, date: ISODate, onClick?: () => void) {
		if (readonly || e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		const span = stripSpan(stretchesOf(history, today), today);
		if (!span || trackWidth === 0) return;
		const d: Drag = {
			from: date,
			to: date,
			bounds: changeBounds(history, date, today),
			startX: e.clientX,
			pxPerDay: trackWidth / span.days,
			moved: false,
		};
		drag = d;
		const move = (ev: PointerEvent) => {
			if (ev.pointerId !== e.pointerId || !drag) return;
			const dx = ev.clientX - d.startX;
			if (!drag.moved && Math.abs(dx) < DRAG_SLOP_PX) return;
			drag.moved = true;
			drag.to = clampChange(shiftDays(d.from, Math.round(dx / d.pxPerDay)), d.bounds);
		};
		const end = (ev: PointerEvent, commit: boolean) => {
			if (ev.pointerId !== e.pointerId) return;
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
			const done = drag;
			drag = null;
			if (!commit || !done) return;
			if (done.moved && done.to !== done.from) onMoveChange(done.from, done.to);
			else if (!done.moved) onClick?.();
		};
		const up = (ev: PointerEvent) => end(ev, true);
		// A cancelled pointer (a touch that became a scroll) writes nothing.
		const cancel = (ev: PointerEvent) => end(ev, false);
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
	}

	function formatDate(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	// The dragged change's place on the strip, for the date shown over it.
	const dragLeft = $derived.by(() => {
		const d = drag;
		if (!d?.moved) return null;
		return parts.find((p) => p.stretch.start === d.to)?.left ?? null;
	});
</script>

<div class="kairos-strip" class:is-readonly={readonly} class:is-dragging={drag?.moved}>
	{#if drag && dragLeft !== null}
		<div class="kairos-strip-when">
			<span style:left={`${dragLeft * 100}%`}>{formatDate(drag.to)}</span>
		</div>
	{/if}
	<div class="kairos-strip-track" bind:clientWidth={trackWidth}>
		{#each parts as p (p.stretch.rec)}
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
						ariaLabel={`Active from ${formatDate(s.start)}. Click to edit the intention, drag an end to move the change.`}
						onpick={readonly ? undefined : (level: number | undefined) => onPickIntensity(s.start, level)}
						onclick={() => onSelect("stretch", s.start)}
					/>
					{#if !readonly}
						<!-- Each end is a change: drag it to move that change's date. -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="kairos-strip-edge is-start"
							aria-label={`Drag to move the change on ${formatDate(s.start)}`}
							onpointerdown={(e) => beginDrag(e, s.start)}
						></div>
						{#if s.end}
							{@const end = s.end}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="kairos-strip-edge is-end"
								aria-label={`Drag to move the change on ${formatDate(end)}`}
								onpointerdown={(e) => beginDrag(e, end)}
							></div>
						{/if}
					{/if}
				</div>
			{/if}
		{/each}
	</div>
	<div class="kairos-strip-marks">
		{#each parts as p (p.stretch.rec)}
			{@const s = p.stretch}
			<div
				class="kairos-strip-mark"
				class:is-marked={marked?.part === "transition" && marked.date === s.start}
				class:is-dragged={drag?.moved && drag.to === s.start}
				data-status={s.rec.status}
				style:left={`${p.left * 100}%`}
				role="button"
				tabindex={readonly ? -1 : 0}
				aria-label={`Changed to ${STATUS_LABEL[s.rec.status].toLowerCase()} on ${formatDate(s.start)}. Click to add the reason, drag to move it.`}
				onpointerdown={(e) => beginDrag(e, s.start, () => onSelect("transition", s.start))}
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
		/* It moves sideways, and a click opens its reason. */
		cursor: ew-resize;
		transition: transform 80ms ease-out;
	}
	.kairos-strip-mark:is(:hover, :focus-visible),
	.kairos-strip-mark.is-dragged {
		transform: translateX(-50%) rotate(45deg) scale(1.1);
		box-shadow: 0 0 0 2px var(--background-primary), 0 0 0 3px var(--kairos-strip-mark);
	}

	/* A bar's ends are changes: a grab zone straddling each cap, which shows a
	   line in the accent colour on hover, as the Timeline's edges do. */
	.kairos-strip-edge {
		position: absolute;
		top: calc(-1 * var(--size-2-1));
		bottom: calc(-1 * var(--size-2-1));
		width: var(--size-4-2);
		z-index: 3;
		cursor: ew-resize;
	}
	.kairos-strip-edge.is-start {
		left: calc(-1 * var(--size-4-1));
	}
	.kairos-strip-edge.is-end {
		right: calc(-1 * var(--size-4-1));
	}
	.kairos-strip-edge::after {
		content: "";
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(50% - 1px);
		width: 2px;
		border-radius: var(--kairos-radius-s);
		background: var(--interactive-accent);
		opacity: 0;
	}
	.kairos-strip-edge:hover::after {
		opacity: 1;
	}
	.kairos-strip.is-dragging,
	.kairos-strip.is-dragging * {
		cursor: ew-resize;
		user-select: none;
	}
	/* The date a dragged change will land on, over the strip. */
	.kairos-strip-when {
		position: relative;
		height: var(--size-4-4);
	}
	.kairos-strip-when span {
		position: absolute;
		bottom: 0;
		transform: translateX(-50%);
		padding: 0 var(--size-2-2);
		border-radius: var(--kairos-radius-s);
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-size: var(--kairos-text-meta);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
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
