<script lang="ts">
	// PROTOTYPE: a small badge on a day's column header (Week, Grid) that opens
	// a list — the day's Unscheduled tasks, or its Inbox. A sibling of the
	// routines pill (RoutinesAlert, variant "pill"): same size, same feel. A
	// mouse resting on it peeks at the list; a click or tap opens it at once.
	// The list is portaled and fixed, since a view's leaf is a transformed,
	// clipping ancestor.
	//
	// It takes no vertical room in the view, which is the point: the strips
	// these replace pushed every column down.

	import type { Snippet } from "svelte";

	interface Props {
		/** The list's heading, in serif ("Unscheduled"). */
		title: string;
		/** The day, in small capitals at the heading's right ("Wed 28"). */
		dateLabel?: string;
		count: number;
		icon: Snippet;
		children: Snippet;
		/** Actions on the list's heading line ("Bring all"). */
		actions?: Snippet;
		/** "warn" tints it, for a list that's waiting on a decision. */
		tone?: "neutral" | "warn";
		/** Open state, bindable so the view can open it (after a cell's "+"). */
		open?: boolean;
		/** A task drag is running anywhere: close, and don't open. */
		dragging?: boolean;
		/** Makes the badge a drop target that unschedules onto this date. */
		dropDate?: string;
		/** The drag is over this badge. */
		dropTarget?: boolean;
	}

	let {
		title,
		dateLabel,
		count,
		icon,
		children,
		actions,
		tone = "neutral",
		// No default: the views bind it to a per-day map whose entries start
		// undefined, and Svelte rejects undefined on a bound prop with a fallback.
		open = $bindable(),
		dragging = false,
		dropDate,
		dropTarget = false,
	}: Props = $props();

	let rootEl = $state<HTMLDivElement>();
	let triggerEl = $state<HTMLButtonElement>();
	let panelEl = $state<HTMLDivElement>();
	let panelStyle = $state("");
	let timer: number | undefined;
	const OPEN_MS = 250;
	const CLOSE_MS = 150;
	const PANEL_WIDTH = 300;

	function clearTimer() {
		window.clearTimeout(timer);
		timer = undefined;
	}

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
		return !!node && (!!rootEl?.contains(node) || !!panelEl?.contains(node));
	}

	function place() {
		const el = triggerEl;
		if (!el) return;
		const win = el.ownerDocument.defaultView ?? window;
		const r = el.getBoundingClientRect();
		const top = r.bottom + 4;
		const maxHeight = Math.max(160, win.innerHeight - top - 12);
		const width = Math.min(PANEL_WIDTH, win.innerWidth - 16);
		const left = Math.min(Math.max(8, r.right - width), win.innerWidth - width - 8);
		panelStyle = `top: ${top}px; left: ${left}px; width: ${width}px; max-height: ${maxHeight}px;`;
	}

	function show() {
		if (dragging) return;
		clearTimer();
		place();
		open = true;
	}
	function hide() {
		clearTimer();
		open = false;
	}

	// Opened from outside (bind:open): place it before it paints.
	$effect(() => {
		if (open) place();
	});
	$effect(() => {
		if (dragging) hide();
	});

	function onEnter(e: PointerEvent) {
		if (e.pointerType !== "mouse" || dragging) return;
		clearTimer();
		if (!open) timer = window.setTimeout(show, OPEN_MS);
	}
	function onLeave(e: PointerEvent) {
		if (e.pointerType !== "mouse") return;
		clearTimer();
		if (inside(e.relatedTarget)) return;
		if (open) timer = window.setTimeout(hide, CLOSE_MS);
	}
	function onClick(e: MouseEvent) {
		e.stopPropagation();
		if (open) hide();
		else show();
	}

	// While open: a press outside closes it, and so does scrolling the view
	// under it. Menus and pickers a row opens are portaled too, so a press in
	// one of those (`.menu`, a picker) doesn't count as outside.
	$effect(() => {
		const el = rootEl;
		if (!open || !el) return;
		const win = el.ownerDocument.defaultView ?? window;
		const elsewhere = (t: EventTarget | null) => {
			if (inside(t)) return false;
			const node = t as Element | null;
			return !node?.closest?.(".menu, .block-picker, .assoc-picker, .resurface-popup");
		};
		const onPress = (e: PointerEvent) => {
			if (elsewhere(e.target)) hide();
		};
		const onScroll = (e: Event) => {
			if (!inside(e.target)) hide();
		};
		win.addEventListener("pointerdown", onPress, true);
		win.addEventListener("scroll", onScroll, true);
		return () => {
			win.removeEventListener("pointerdown", onPress, true);
			win.removeEventListener("scroll", onScroll, true);
		};
	});
	$effect(() => () => clearTimer());
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="hb"
	class:warn={tone === "warn"}
	class:open
	class:drop-target={dropTarget}
	data-unscheduled-date={dropDate}
	bind:this={rootEl}
	onpointerenter={onEnter}
	onpointerleave={onLeave}
>
	<button
		class="hb-trigger"
		bind:this={triggerEl}
		aria-expanded={!!open}
		aria-label={`${title}${dateLabel ? ` · ${dateLabel}` : ""}: ${count}`}
		onclick={onClick}
	>
		{@render icon()}
		<span class="hb-count">{count}</span>
	</button>
	{#if open}
		<div
			class="hb-panel"
			style={panelStyle}
			role="dialog"
			tabindex="-1"
			aria-label={dateLabel ? `${title} · ${dateLabel}` : title}
			bind:this={panelEl}
			use:portal
			onpointerenter={onEnter}
			onpointerleave={onLeave}
		>
			<div class="hb-head">
				<span class="hb-title">{title}</span>
				{#if actions}{@render actions()}{/if}
				{#if dateLabel}<span class="hb-date">{dateLabel}</span>{/if}
			</div>
			<div class="hb-list">
				{@render children()}
			</div>
		</div>
	{/if}
</div>

<style>
	.hb {
		display: inline-flex;
	}

	.hb-trigger {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 18px;
		padding: 0 6px;
		border-radius: 9px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		box-shadow: none;
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		cursor: pointer;
	}

	.hb-trigger:hover,
	.hb.open .hb-trigger {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.hb.warn .hb-trigger {
		color: var(--color-orange);
		border-color: color-mix(in srgb, var(--color-orange) 45%, transparent);
		background: color-mix(in srgb, var(--color-orange) 12%, var(--background-primary));
	}

	.hb.drop-target .hb-trigger {
		border-color: var(--interactive-accent);
		color: var(--interactive-accent);
	}

	.hb-trigger :global(svg) {
		flex-shrink: 0;
	}

	.hb-count {
		font-variant-numeric: tabular-nums;
	}

	.hb-panel {
		position: fixed;
		z-index: var(--layer-popover);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-s);
		box-shadow: var(--shadow-s);
		padding: 10px 12px 10px;
	}

	/* Kairos's own type: the list's name in serif, the day in small capitals
	   on the right, like the column header the badge sits on. */
	.hb-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 0 0 8px;
		margin-bottom: 2px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.hb-title {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: Georgia, "Times New Roman", serif;
		font-size: 15px;
		color: var(--text-normal);
	}

	.hb-date {
		flex-shrink: 0;
		font-size: var(--font-ui-smaller);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.hb-head :global(button) {
		height: auto;
		padding: 1px 8px;
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-normal);
	}

	.hb-list {
		overflow-y: auto;
		margin-right: -4px;
		padding-right: 4px;
	}
</style>
