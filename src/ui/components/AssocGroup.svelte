<script lang="ts">
	// A group heading and its rows, in Kairos's own look (decision 113): a bar
	// in the domain color down the group's left edge, like a block on the
	// timeline, then the project (folder) or domain icon, the name in serif and
	// its count, and a "+" on the right. Ctrl/Cmd+click on the heading opens the
	// project or domain.
	//
	// Every grouped list uses it: Unscheduled, the Inbox, the Backlog, the
	// Projects view's domains and the Routines view's repeat groups. A group that
	// isn't an association (a routine's "Every weekday") passes `label` and
	// `icon`, and gets a plain bar. A view adds its own bits with `meta` (after
	// the count) and `actions` (before the "+").

	import type { Snippet } from "svelte";
	import DraftTask from "../task/DraftTask.svelte";
	import IconButton from "./IconButton.svelte";
	import { icon as drawIcon } from "../actions/icon";
	import type { Association } from "../../types";
	import type { ResolvedAssociation } from "../../association";

	interface Props {
		/** Undefined for the "No project" group, or a group that isn't one. */
		assoc?: Association;
		resolved?: ResolvedAssociation;
		/** The name of a group that isn't an association. */
		label?: string;
		/** An Obsidian icon name, in place of the association's kind icon. */
		icon?: string;
		/** The bar's color, where there's no `resolved` to take it from. */
		color?: string;
		count: number;
		onNavigate?: (assoc: Association) => void;
		/** Ctrl/Cmd+click, where opening isn't `onNavigate` (a domain's file). */
		onOpen?: (event: MouseEvent) => void;
		/** The "No project" group's name, where a list calls it something else. */
		noneLabel?: string;
		/** Clicking the name asks to rename it; the parent sets `editing`. */
		onStartRename?: () => void;
		editing?: boolean;
		/** The edited name, when the field loses focus. */
		onRename?: (name: string) => void;
		/** An inactive group: the whole group dims. */
		dim?: boolean;
		/** The heading sticks to the top of the scroll while its rows pass. */
		sticky?: boolean;
		oncontextmenu?: (event: MouseEvent) => void;
		/** Shows a "+" on the right, to add a row to this group. */
		onAdd?: (anchor: DOMRect) => void;
		/** Or: the "+" opens a row to type a task into, at the group's end. */
		onAddText?: (text: string) => void;
		addLabel?: string;
		/** After the count: a description, a status tag. */
		meta?: Snippet;
		/** On the right, before the "+": a view's own buttons. */
		actions?: Snippet;
		children: Snippet;
	}

	let {
		assoc,
		resolved,
		label,
		icon,
		color,
		count,
		onNavigate,
		onOpen,
		noneLabel = "No project",
		onStartRename,
		editing = false,
		onRename,
		dim = false,
		sticky = false,
		oncontextmenu,
		onAdd,
		onAddText,
		addLabel = "Add",
		meta,
		actions,
		children,
	}: Props = $props();

	const name = $derived(label ?? (assoc ? (resolved?.displayName || assoc.id) : noneLabel));
	const isNone = $derived(!assoc && label === undefined);
	const iconName = $derived(
		icon ?? (assoc?.kind === "domain" ? "presentation" : assoc ? "folder-symlink" : undefined),
	);
	const canNavigate = $derived(!!onOpen || !!(assoc && resolved?.resolved && onNavigate));
	const hint = $derived(
		[
			onStartRename && "Click to rename",
			canNavigate && "Ctrl/Cmd+click to open",
			oncontextmenu && "Right-click for more",
		]
			.filter(Boolean)
			.join(" · ") || undefined,
	);
	let drafting = $state(false);

	function click(event: MouseEvent) {
		if (!(event.ctrlKey || event.metaKey)) return;
		if (onOpen) {
			event.stopPropagation();
			onOpen(event);
		} else if (assoc && onNavigate) {
			event.stopPropagation();
			onNavigate(assoc);
		}
	}

	function clickName(event: MouseEvent) {
		if (!onStartRename || event.ctrlKey || event.metaKey) return;
		event.stopPropagation();
		onStartRename();
	}

	function renameKeys(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (e.key === "Enter") e.currentTarget.blur();
		if (e.key === "Escape") {
			e.currentTarget.value = name;
			e.currentTarget.blur();
		}
	}
</script>

<div
	class="ag"
	class:none={isNone}
	class:dim
	class:sticky
	style:--ag-color={color ?? resolved?.color}
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="ag-head"
		class:is-linked={canNavigate}
		title={hint}
		onclick={click}
		{oncontextmenu}
	>
		{#if iconName}
			<span class="ag-icon" use:drawIcon={iconName}></span>
		{/if}
		{#if editing}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="ag-name ag-name-input kairos-inline-input"
				value={name}
				autofocus
				onclick={(e) => e.stopPropagation()}
				onblur={(e) => onRename?.(e.currentTarget.value)}
				onkeydown={renameKeys}
			/>
		{:else if onStartRename}
			<span
				class="ag-name is-editable"
				role="button"
				tabindex="0"
				onclick={clickName}
				onkeydown={(e) => {
					if (e.key === "Enter") onStartRename();
				}}>{name}</span
			>
		{:else}
			<span class="ag-name">{name}</span>
		{/if}
		<span class="ag-count">{count}</span>
		{@render meta?.()}
		<span class="ag-spacer"></span>
		{@render actions?.()}
		{#if onAdd || onAddText}
			<span class="ag-add">
				<IconButton
					label={addLabel}
					icon="plus"
					onclick={(e: MouseEvent) => {
						if (onAddText) drafting = true;
						else onAdd?.((e.currentTarget as HTMLElement).getBoundingClientRect());
					}}
				/>
			</span>
		{/if}
	</div>
	{@render children()}
	{#if drafting && onAddText}
		<DraftTask
			color={resolved?.color}
			onSubmit={onAddText}
			onClose={() => (drafting = false)}
		/>
	{/if}
</div>

<style>
	.ag {
		margin-top: 8px;
		padding-left: 6px;
		border-left: var(--kairos-accent-width) solid var(--ag-color, var(--background-modifier-border));
	}

	.ag:first-child {
		margin-top: 4px;
	}

	.ag.none {
		border-left-style: dashed;
	}

	.ag.dim {
		opacity: 0.55;
	}

	.ag-head {
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		padding: 0 4px 2px;
	}

	/* Sticky headings cover the rows scrolling under them. */
	.ag.sticky .ag-head {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--background-primary);
	}

	.ag-name {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--kairos-font-serif);
		font-size: var(--kairos-text-name);
		color: var(--text-normal);
	}

	.ag.none .ag-name {
		color: var(--text-muted);
	}

	.ag-name.is-editable {
		cursor: text;
	}

	.ag-name-input {
		flex: 1;
		font: inherit;
		font-family: var(--kairos-font-serif);
		font-size: var(--kairos-text-name);
	}

	.ag-spacer {
		flex: 1;
	}

	.ag-icon {
		--icon-size: var(--icon-xs);
		display: flex;
		flex-shrink: 0;
		color: var(--ag-color, var(--text-muted));
	}

	.ag-count {
		flex-shrink: 0;
		min-width: 1ch;
		text-align: right;
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	/* The button keeps the heading's height. */
	.ag-add {
		display: flex;
		margin: -2px 0;
	}

	.ag-head.is-linked {
		cursor: pointer;
	}

	.ag-head.is-linked:hover .ag-name {
		text-decoration: underline;
	}
</style>
