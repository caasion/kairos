<script lang="ts">
	// A day's missing routines, folded into one compact alert.
	//
	// Routines are a known shape you mostly pull in whole, so unlike Unscheduled
	// and Resurfacing they don't take room in the view: they collapse to a bar
	// (the Day view) or a pill (Week and Grid column headers) that says how many
	// are missing. Pointing at it for a moment (mouse), or tapping it (touch),
	// opens the list over whatever is below, the same way an overflowing timeline
	// block grows; it closes when the pointer leaves or on a press elsewhere.
	//
	// The list (preview.ts `listRoutines`): blocks by start time with their tasks
	// nested, each added as a whole; then tasks that name a block already in the
	// day; then tasks with no block, muted, since routine tasks should belong to
	// a block. "Add all" adds everything and records the day as set up. Purely
	// presentational: the parent owns the writes.

	import type { Routine } from "../../routines/routinesFile";
	import type { RoutineItem, RoutineList } from "../../routines/preview";
	import { formatTimeRange } from "../../parser";

	interface Props {
		list: RoutineList;
		/** A full-width bar (Day view) or a small pill (column headers). */
		variant: "bar" | "pill";
		/** The day, for the list's heading ("Routines for Mon, Oct 12"). */
		label: string;
		/** Hidden when routines are added to new daily notes automatically. */
		showAddAll: boolean;
		/** Add one item: a block with its tasks, or one task. */
		onAdd: (routines: Routine[]) => void;
		/** Add every missing routine and record the day as set up. */
		onAddAll: () => void;
	}

	let { list, variant, label, showAddAll, onAdd, onAddAll }: Props = $props();

	let rootEl = $state<HTMLDivElement>();
	let triggerEl = $state<HTMLElement>();
	let panelEl = $state<HTMLDivElement>();
	let open = $state(false);
	let panelStyle = $state("");
	let timer: number | undefined;
	// The same feel as a timeline block's "N more": a pointer passing over on its
	// way somewhere else shouldn't open it.
	const OPEN_MS = 250;
	const CLOSE_MS = 150;
	const PANEL_WIDTH = 280;

	function clearTimer() {
		window.clearTimeout(timer);
		timer = undefined;
	}

	// The panel is portaled to the body and fixed there: a view's leaf is a
	// transformed, clipping ancestor, which would otherwise offset and cut it.
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
		// The bar's list spans the whole bar; a pill's hangs under the pill.
		const el = variant === "bar" ? rootEl : triggerEl;
		if (!el) return;
		const win = el.ownerDocument.defaultView ?? window;
		const r = el.getBoundingClientRect();
		const top = r.bottom + 4;
		const maxHeight = Math.max(120, win.innerHeight - top - 12);
		if (variant === "bar") {
			panelStyle = `top: ${top}px; left: ${r.left}px; width: ${r.width}px; max-height: ${maxHeight}px;`;
			return;
		}
		const width = Math.min(PANEL_WIDTH, win.innerWidth - 16);
		const left = Math.min(Math.max(8, r.right - width), win.innerWidth - width - 8);
		panelStyle = `top: ${top}px; left: ${left}px; width: ${width}px; max-height: ${maxHeight}px;`;
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
		if (e.pointerType !== "mouse") return;
		clearTimer();
		if (!open) timer = window.setTimeout(show, OPEN_MS);
	}
	function onLeave(e: PointerEvent) {
		if (e.pointerType !== "mouse") return;
		clearTimer();
		// Moving between the alert and its list (portaled, so not a DOM child)
		// isn't leaving.
		if (inside(e.relatedTarget)) return;
		if (open) timer = window.setTimeout(hide, CLOSE_MS);
	}
	// Touch has no hover: a tap toggles. A click with a mouse opens at once.
	function onTriggerClick(e: MouseEvent) {
		e.stopPropagation();
		if (open) hide();
		else show();
	}

	// While open: a press outside closes it, and so does scrolling the view
	// under it (the panel is fixed and would drift from its trigger).
	$effect(() => {
		const el = rootEl;
		if (!open || !el) return;
		const win = el.ownerDocument.defaultView ?? window;
		const onPress = (e: PointerEvent) => {
			if (!inside(e.target)) hide();
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

	const summary = $derived(`${list.count} routine${list.count === 1 ? "" : "s"} to add`);
</script>

{#snippet arrow(item: RoutineItem, what: string)}
	<button
		class="ra-insert"
		aria-label={`Add ${what}`}
		title={`Add ${what} to this day`}
		onclick={(e) => {
			e.stopPropagation();
			onAdd(item.routines);
		}}
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
	</button>
{/snippet}

{#snippet repeatIcon(size: number)}
	<svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="ra"
	class:ra-bar={variant === "bar"}
	class:ra-pill={variant === "pill"}
	class:open
	bind:this={rootEl}
	onpointerenter={onEnter}
	onpointerleave={onLeave}
>
	{#if variant === "bar"}
		<div class="ra-bar-row">
			<button
				class="ra-bar-trigger"
				bind:this={triggerEl}
				aria-expanded={open}
				onclick={onTriggerClick}
			>
				{@render repeatIcon(11)}
				<span>{summary}</span>
			</button>
			{#if showAddAll}
				<button
					class="ra-add-all"
					onclick={(e) => {
						e.stopPropagation();
						hide();
						onAddAll();
					}}
				>Add all</button>
			{/if}
		</div>
	{:else}
		<button
			class="ra-pill-trigger"
			bind:this={triggerEl}
			aria-expanded={open}
			aria-label={summary}
			onclick={onTriggerClick}
		>
			{@render repeatIcon(12)}
			<span class="ra-count">{list.count}</span>
		</button>
	{/if}

	{#if open}
		<div
			class="ra-panel"
			style={panelStyle}
			role="dialog"
			tabindex="-1"
			aria-label={`Routines for ${label}`}
			bind:this={panelEl}
			use:portal
			onpointerenter={onEnter}
			onpointerleave={onLeave}
		>
			<div class="ra-head">
				<span class="ra-title">Routines</span>
				{#if showAddAll && variant === "pill"}
					<button
						class="ra-add-all"
						onclick={(e) => {
							e.stopPropagation();
							hide();
							onAddAll();
						}}
					>Add all</button>
				{/if}
				<span class="ra-date">{label}</span>
			</div>
			{#each list.items as item (item.key)}
				{#if item.block}
					{@const block = item.block}
					<div class="ra-item">
						<div class="ra-row">
							{@render arrow(item, block.title)}
							<span class="ra-time">{formatTimeRange(block.time)}</span>
							<span class="ra-text">{block.title}</span>
						</div>
						{#each item.tasks as task (task.line)}
							<div class="ra-task">{task.text}</div>
						{/each}
					</div>
				{:else}
					{@const task = item.tasks[0]!}
					<div class="ra-item">
						<div class="ra-row">
							{@render arrow(item, task.text)}
							<span class="ra-text">{task.text}</span>
						</div>
						{#if task.home}
							<div class="ra-task ra-home">in {task.home}</div>
						{/if}
					</div>
				{/if}
			{/each}
			{#if list.loose.length > 0}
				<div class="ra-loose-label">No block</div>
				{#each list.loose as item (item.key)}
					<div class="ra-item ra-loose">
						<div class="ra-row">
							{@render arrow(item, item.tasks[0]!.text)}
							<span class="ra-text">{item.tasks[0]!.text}</span>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	/* The panel is portaled out of .ra, so it carries the accent itself. */
	.ra,
	.ra-panel {
		--ra-accent: var(--interactive-accent);
	}
	.ra {
		min-width: 0;
	}

	/* ── Bar (Day view) ── */
	.ra-bar-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 2px 4px;
		border-radius: 7px;
		border: 1px dashed color-mix(in srgb, var(--ra-accent) 45%, transparent);
	}
	.ra-bar.open .ra-bar-row,
	.ra-bar-row:hover {
		background: color-mix(in srgb, var(--ra-accent) 8%, var(--background-primary));
	}
	.ra-bar-trigger {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 0;
		height: 22px;
		padding: 0 4px;
		background: transparent;
		box-shadow: none;
		color: var(--ra-accent);
		font-size: 12px;
		cursor: pointer;
		justify-content: flex-start;
	}
	.ra-bar-trigger:hover {
		background: transparent;
		box-shadow: none;
	}
	.ra-bar-trigger span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Pill (column headers) ── */
	.ra-pill-trigger {
		display: flex;
		align-items: center;
		gap: 3px;
		height: 20px;
		padding: 0 6px;
		border-radius: 10px;
		border: 1px dashed color-mix(in srgb, var(--ra-accent) 50%, transparent);
		background: var(--background-primary);
		color: var(--ra-accent);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		box-shadow: none;
		cursor: pointer;
	}
	.ra-pill.open .ra-pill-trigger,
	.ra-pill-trigger:hover {
		background: var(--ra-accent);
		color: var(--text-on-accent);
		border-style: solid;
		box-shadow: none;
	}
	.ra-count {
		line-height: 1;
	}

	.ra-add-all {
		flex-shrink: 0;
		height: 22px;
		padding: 0 8px;
		border-radius: 5px;
		font-size: 11px;
		background: transparent;
		color: var(--ra-accent);
		box-shadow: none;
		cursor: pointer;
	}
	.ra-add-all:hover {
		background: var(--ra-accent);
		color: var(--text-on-accent);
		box-shadow: none;
	}

	/* ── The list ── */
	.ra-panel {
		position: fixed;
		z-index: var(--layer-popover);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
		/* The same look as the header badges' lists (HeaderBadge). */
		padding: 10px 12px;
		border-radius: var(--radius-s);
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		box-shadow: var(--shadow-s);
		text-align: left;
	}
	.ra-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 0 0 8px;
		margin-bottom: 4px;
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.ra-title {
		flex: 1;
		min-width: 0;
		font-family: Georgia, "Times New Roman", serif;
		font-size: 15px;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ra-date {
		flex-shrink: 0;
		font-size: var(--font-ui-smaller);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.ra-item {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 2px 4px;
		border-radius: 6px;
		min-width: 0;
	}
	.ra-item:hover {
		background: color-mix(in srgb, var(--ra-accent) 8%, var(--background-primary));
	}
	.ra-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.ra-insert {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 18px;
		width: 18px;
		min-width: fit-content;
		flex-shrink: 0;
		padding: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--ra-accent);
		box-shadow: none;
		cursor: pointer;
	}
	.ra-insert:hover {
		background: var(--ra-accent);
		color: var(--text-on-accent);
		box-shadow: none;
	}
	.ra-time {
		flex-shrink: 0;
		font-size: 11px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.ra-text {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ra-task {
		/* Under the text, past the 18px arrow and the row gap. */
		padding-left: 24px;
		font-size: 11px;
		line-height: 1.35;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ra-home {
		color: var(--text-faint);
	}
	.ra-loose-label {
		margin-top: 4px;
		padding: 2px 4px 0;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-faint);
	}
	.ra-loose .ra-text {
		color: var(--text-muted);
	}
</style>
