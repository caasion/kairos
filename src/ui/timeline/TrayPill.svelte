<script lang="ts">
	// One of the Day view's tray pills: a label and a count that opens its list
	// over the timeline.
	//
	// Unscheduled, "Left from" and Resurfacing used to stack above the timeline
	// in full and took close to half a sidebar. Each is now a pill in one strip.
	// Pointing at a pill for a moment (mouse) opens its list, and it closes when
	// the pointer leaves; a click (or a tap) opens it and keeps it open until a
	// press elsewhere, Escape, or another click on the pill. The list spans the
	// strip's width, under it, portaled like the routines alert's.
	//
	// During a task drag the list closes so the timeline under it is reachable,
	// and the Unscheduled pill is itself the drop target (`dropDate`).

	import type { Snippet } from "svelte";

	interface Props {
		label: string;
		count: number;
		/** The list's heading. */
		title: string;
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
	}

	let {
		label,
		count,
		title,
		anchor,
		icon,
		actions,
		children,
		dropDate,
		dragging = false,
		dropTarget = false,
	}: Props = $props();

	let pillEl = $state<HTMLButtonElement>();
	let panelEl = $state<HTMLDivElement>();
	let open = $state(false);
	// Opened by a click: stays open when the pointer leaves.
	let pinned = $state(false);
	let panelStyle = $state("");
	let timer: number | undefined;
	// The same delays as the routines alert and a block's "N more".
	const OPEN_MS = 250;
	const CLOSE_MS = 150;

	function clearTimer() {
		window.clearTimeout(timer);
		timer = undefined;
	}

	// Portaled to the body and fixed there: a view's leaf is a transformed,
	// clipping ancestor, which would otherwise offset and cut it.
	function portal(node: HTMLElement) {
		node.ownerDocument.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			},
		};
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

	function show(pin: boolean) {
		clearTimer();
		place();
		open = true;
		pinned = pin;
	}
	function hide() {
		clearTimer();
		open = false;
		pinned = false;
	}

	function onEnter(e: PointerEvent) {
		if (e.pointerType !== "mouse" || dragging) return;
		clearTimer();
		if (!open) timer = window.setTimeout(() => show(false), OPEN_MS);
	}
	function onLeave(e: PointerEvent) {
		if (e.pointerType !== "mouse") return;
		clearTimer();
		// Moving between the pill and its list (portaled, so not a DOM child)
		// isn't leaving.
		if (pinned || inside(e.relatedTarget)) return;
		if (open) timer = window.setTimeout(hide, CLOSE_MS);
	}
	// A click pins a hover-opened list rather than closing it; a second click
	// closes.
	function onClick(e: MouseEvent) {
		e.stopPropagation();
		if (open && pinned) hide();
		else show(true);
	}

	$effect(() => {
		if (dragging) hide();
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
	class:drop-target={dropTarget}
	data-unscheduled-date={dropDate}
	aria-expanded={open}
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
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="tray-panel"
		style={panelStyle}
		role="dialog"
		tabindex="-1"
		aria-label={title}
		bind:this={panelEl}
		use:portal
		onpointerenter={onEnter}
		onpointerleave={onLeave}
		onclick={(e) => e.stopPropagation()}
	>
		<div class="tp-head">
			<span class="tp-title">{title}</span>
			{#if actions}{@render actions()}{/if}
		</div>
		{@render children()}
	</div>
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

	.tray-panel {
		position: fixed;
		z-index: var(--layer-popover);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 4px 6px 6px;
		border-radius: 8px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		box-shadow: var(--shadow-s);
		text-align: left;
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
