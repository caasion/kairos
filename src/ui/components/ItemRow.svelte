<script lang="ts">
	// One item in a list: a task, a leftover, a resurfaced backlog nudge, a
	// backlog entry, the typing row. Every item row is built from this, so they
	// share one layout:
	//
	//   [lead] [text ……………………] [trailing label] [tag] [trail]   [actions]
	//          [meta line, under the text]
	//
	// • `lead`: the leading control, 18px wide (a checkbox, an arrow, a bullet
	//   in an 18px box). The meta line's indent assumes that width.
	// • `children`: the text, drawn with ItemText.
	// • `trailing`: a short muted label after the text that gives way first
	//   when the line is tight. `tag`: where the item came from, faint, with an
	//   icon. `trail`: buttons at the end of the line.
	// • `meta`: the line beneath (association, dates, badges), on the shared
	//   `.kairos-meta` classes.
	// • `actions`: the corner action bar (`.kairos-action-bar`), woken from the
	//   corner by actionZone when `zone` is set.
	//
	// It keeps no state and runs no effects, so it adds nothing per row beyond
	// its elements. Snippets are compiled where they're written, so the caller
	// styles what it puts in them.

	import type { Snippet } from "svelte";
	import { actionZone, type ActionZoneOptions } from "../actions/actionZone";
	import { icon as drawIcon } from "../actions/icon";

	interface Props {
		lead?: Snippet;
		children: Snippet;
		trail?: Snippet;
		meta?: Snippet;
		actions?: Snippet;
		trailing?: string;
		tag?: { icon: string; text: string; title: string };
		// "s" for timelines and grids; "m" for the roomier sidebar lists
		// (larger text, more padding).
		size?: "s" | "m";
		// The text wraps: keep the lead and trail on its first line.
		wraps?: boolean;
		// Square corners, for rows packed edge to edge inside a block.
		square?: boolean;
		// A tint in `color`: "block" when the item's block is pointed at
		// elsewhere, "task" (stronger, with a bar) when the item itself is,
		// "new" for the row being typed.
		lit?: "block" | "task" | "new" | null;
		// Always tinted in `color`, with a border (a resurfaced nudge).
		tinted?: boolean;
		// The tint colour. Omit to inherit the surrounding block's, else the
		// theme accent.
		color?: string;
		// Wake `actions` from the row's corner (actions/actionZone.ts).
		zone?: ActionZoneOptions;
		el?: HTMLDivElement;
		class?: string;
		title?: string;
		oncontextmenu?: (event: MouseEvent) => void;
		onpointerenter?: (event: PointerEvent) => void;
		onpointerleave?: (event: PointerEvent) => void;
	}

	let {
		lead,
		children,
		trail,
		meta,
		actions,
		trailing,
		tag,
		size = "s",
		wraps = false,
		square = false,
		lit = null,
		tinted = false,
		color,
		zone,
		el = $bindable(),
		class: className = "",
		title,
		oncontextmenu,
		onpointerenter,
		onpointerleave,
	}: Props = $props();

	// The zone is fixed for a row's life: a row without one gets no listeners.
	function zoneIf(node: HTMLElement, options: ActionZoneOptions | undefined) {
		return options ? actionZone(node, options) : undefined;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="kairos-item {className}"
	class:size-m={size === "m"}
	class:square
	class:tinted
	class:lit-block={lit === "block"}
	class:lit-task={lit === "task"}
	class:lit-new={lit === "new"}
	style:--kairos-link-color={color}
	{title}
	bind:this={el}
	{oncontextmenu}
	{onpointerenter}
	{onpointerleave}
	use:zoneIf={zone}
>
	{@render actions?.()}

	<div class="kairos-item-line" class:wraps>
		{@render lead?.()}
		{@render children()}
		{#if trailing}<span class="kairos-item-trailing" title={trailing}>{trailing}</span>{/if}
		{#if tag}
			<span class="kairos-item-tag" title={tag.title}
				><span class="kairos-item-tag-icon" use:drawIcon={tag.icon}></span>{tag.text}</span
			>
		{/if}
		{@render trail?.()}
	</div>

	{#if meta}
		<div class="kairos-meta-row is-indented">{@render meta()}</div>
	{/if}
</div>

<style>
	.kairos-item {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		padding: 2px 4px;
		border-radius: var(--kairos-radius-m);
	}
	.kairos-item.size-m {
		--kairos-item-text-size: var(--kairos-text-name);
		padding: 5px 8px;
	}
	.kairos-item.square {
		border-radius: 0;
	}

	.kairos-item:hover {
		background: var(--background-modifier-hover);
	}

	/* Tints, in the row's colour (the block's, else the theme accent). After
	   the hover rule, so a lit row stays lit under the pointer. */
	.kairos-item.tinted {
		background: color-mix(
			in srgb,
			var(--kairos-link-color, var(--interactive-accent)) 10%,
			var(--background-primary)
		);
		border: 1px solid
			color-mix(in srgb, var(--kairos-link-color, var(--interactive-accent)) 22%, transparent);
	}
	.kairos-item.tinted:hover {
		background: color-mix(
			in srgb,
			var(--kairos-link-color, var(--interactive-accent)) 16%,
			var(--background-primary)
		);
	}
	.kairos-item.lit-block,
	.kairos-item.lit-new {
		background: color-mix(
			in srgb,
			var(--kairos-link-color, var(--interactive-accent)) 12%,
			transparent
		);
	}
	.kairos-item.lit-task {
		background: color-mix(
			in srgb,
			var(--kairos-link-color, var(--interactive-accent)) 22%,
			transparent
		);
	}
	.kairos-item.lit-task,
	.kairos-item.lit-new {
		box-shadow: inset var(--kairos-accent-width) 0 0
			var(--kairos-link-color, var(--interactive-accent));
	}

	/* ── The line: lead, text, trailing parts ── */
	.kairos-item-line {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.kairos-item-line.wraps {
		align-items: flex-start;
	}

	/* Same size and line height as the text, so a wrapped row's top-aligned
	   parts share its first line. Its huge shrink factor makes it give way (and
	   truncate) before the text does. */
	.kairos-item-trailing {
		flex: 0 1000 auto;
		min-width: 0;
		margin-left: auto;
		padding-left: 4px;
		font-size: var(--kairos-item-text-size, var(--kairos-text-body));
		line-height: 1.4;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.kairos-item-tag {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		font-size: var(--kairos-text-meta);
		color: var(--text-faint);
		white-space: nowrap;
	}
	.kairos-item-tag-icon {
		--icon-size: var(--kairos-text-meta);
		display: flex;
	}
</style>
