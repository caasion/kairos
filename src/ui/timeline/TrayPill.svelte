<script lang="ts">
	// One of the Day view's tray pills: a label and a count that opens its list
	// over the timeline.
	//
	// Unscheduled, "Left from" and Resurfacing used to stack above the timeline
	// in full and took close to half a sidebar. Each is now a pill in one strip.
	// Pointing at a pill for a moment (mouse) peeks at its list over the
	// timeline, spanning the strip's width under it, portaled like the routines
	// alert's; it closes when the pointer leaves. A click (or a tap) toggles the
	// list into the view instead: the parent shows it under the strip, pushing
	// the timeline down, and the pill stays pressed until it's clicked again.
	//
	// During a task drag the peek closes so the timeline under it is reachable,
	// and the Unscheduled pill is itself the drop target (`dropDate`).

	import type { Snippet } from "svelte";
	import Popover from "../components/Popover.svelte";

	interface Props {
		label: string;
		count: number;
		/** The list's heading. */
		title: string;
		/** The list is toggled into the view (the parent renders it). */
		expanded: boolean;
		onToggle: () => void;
		/** The element the list hangs under and takes its width from. */
		anchor: () => HTMLElement | undefined;
		icon: Snippet;
		/** Actions on the list's heading line (e.g. "Bring all"). */
		actions?: Snippet;
		children: Snippet;
		/** Makes the pill a drop target that unschedules onto this date. */
		dropDate?: string;
		/** A task is being dragged anywhere: close, and don't open. */
		dragging?: boolean;
		/** The drag is over this pill. */
		dropTarget?: boolean;
		/** "warn" tints it, for a list that's waiting on a decision (the Inbox
		 *  with leftovers), like a day header's badge. */
		tone?: "neutral" | "warn";
	}

	let {
		label,
		count,
		title,
		expanded,
		onToggle,
		anchor,
		icon,
		actions,
		children,
		dropDate,
		dragging = false,
		dropTarget = false,
		tone = "neutral",
	}: Props = $props();

	let pillEl = $state<HTMLButtonElement>();
	let panelEl = $state<HTMLDivElement>();
	// The hover peek.
	let open = $state(false);
	let panelStyle = $state("");
	let timer: number | undefined;
	// The same delays as the routines alert and a block's "N more".
	const OPEN_MS = 250;
	const CLOSE_MS = 150;

	function clearTimer() {
		window.clearTimeout(timer);
		timer = undefined;
	}

	function inside(target: EventTarget | null): boolean {
		const node = target as Node | null;
		return !!node && (!!pillEl?.contains(node) || !!panelEl?.contains(node));
	}

	function place() {
		const el = anchor() ?? pillEl;
		if (!el) return;
		const win = el.ownerDocument.defaultView ?? window;
		const r = el.getBoundingClientRect();
		const top = r.bottom + 4;
		const maxHeight = Math.max(120, win.innerHeight - top - 12);
		panelStyle = `top: ${top}px; left: ${r.left}px; width: ${r.width}px; max-height: ${maxHeight}px;`;
	}

	function show() {
		clearTimer();
		place();
		open = true;
	}
	function hide() {
		clearTimer();
		open = false;
	}

	function onEnter(e: PointerEvent) {
		// Nothing to peek at when the list is already in the view.
		if (e.pointerType !== "mouse" || dragging || expanded) return;
		clearTimer();
		if (!open) timer = window.setTimeout(show, OPEN_MS);
	}
	function onLeave(e: PointerEvent) {
		if (e.pointerType !== "mouse") return;
		clearTimer();
		// Moving between the pill and its list (portaled, so not a DOM child)
		// isn't leaving.
		if (inside(e.relatedTarget)) return;
		if (open) timer = window.setTimeout(hide, CLOSE_MS);
	}
	function onClick(e: MouseEvent) {
		e.stopPropagation();
		hide();
		onToggle();
	}

	$effect(() => {
		if (dragging || expanded) hide();
	});

	// While open: a press outside closes it, as do Escape and scrolling the view
	// under it (the list is fixed and would drift from its pill).
	$effect(() => {
		const el = pillEl;
		if (!open || !el) return;
		const win = el.ownerDocument.defaultView ?? window;
		const onPress = (e: PointerEvent) => {
			if (!inside(e.target)) hide();
		};
		const onScroll = (e: Event) => {
			if (!inside(e.target)) hide();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") hide();
		};
		win.addEventListener("pointerdown", onPress, true);
		win.addEventListener("scroll", onScroll, true);
		win.addEventListener("keydown", onKey);
		return () => {
			win.removeEventListener("pointerdown", onPress, true);
			win.removeEventListener("scroll", onScroll, true);
			win.removeEventListener("keydown", onKey);
		};
	});
	$effect(() => () => clearTimer());
</script>

<button
	class="tray-pill"
	class:open
	class:expanded
	class:drop-target={dropTarget}
	class:warn={tone === "warn"}
	data-unscheduled-date={dropDate}
	aria-expanded={expanded}
	aria-label={`${label}, ${count}`}
	bind:this={pillEl}
	onclick={onClick}
	onpointerenter={onEnter}
	onpointerleave={onLeave}
>
	{@render icon()}
	<span class="tp-label">{label}</span>
	<span class="tp-count">{count}</span>
</button>

{#if open}
	<!-- Portaled to the body and fixed there (Popover): a view's leaf is a
	     transformed, clipping ancestor, which would otherwise offset and cut it. -->
	<Popover
		class="tray-panel"
		padding="s"
		gap="s"
		overflow="scroll"
		style={panelStyle}
		role="dialog"
		tabindex={-1}
		aria-label={title}
		bind:el={panelEl}
		onpointerenter={onEnter}
		onpointerleave={onLeave}
		onclick={(e: MouseEvent) => e.stopPropagation()}
	>
		<div class="tp-head">
			<span class="tp-title">{title}</span>
			{#if actions}{@render actions()}{/if}
		</div>
		{@render children()}
	</Popover>
{/if}

<style>
	.tray-pill {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		min-width: 0;
		height: 22px;
		padding: 0 7px;
		border-radius: var(--radius-s);
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		box-shadow: none;
		color: var(--text-muted);
		font-size: 11px;
		cursor: pointer;
	}
	.tray-pill:hover,
	.tray-pill.open {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		box-shadow: none;
	}
	.tray-pill.expanded {
		border-color: color-mix(in srgb, var(--interactive-accent) 50%, var(--background-modifier-border));
		background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary));
		color: var(--text-normal);
	}
	.tray-pill.warn {
		border-color: color-mix(in srgb, var(--color-orange) 45%, transparent);
		background: color-mix(in srgb, var(--color-orange) 12%, var(--background-primary));
		color: var(--color-orange);
	}
	.tray-pill.drop-target {
		border-color: var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 12%, var(--background-primary));
		color: var(--text-normal);
	}
	.tray-pill :global(svg) {
		flex-shrink: 0;
	}
	.tp-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tp-count {
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.tp-head {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 2px 4px;
	}
	.tp-title {
		flex: 1;
		min-width: 0;
		font-size: 11px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
