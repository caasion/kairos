<script lang="ts">
	// A task left open on an earlier day, offered in today's Day view (carry.ts,
	// decision 105). It still lives on that earlier day; this row only asks
	// what to do with it:
	//   • the checkbox marks it done where it is (a long-press cancels it), for
	//     the task you did but forgot to tick;
	//   • the arrow brings it to today's Unscheduled list.
	// Either way it drops out of the list. Presentation mirrors the task row and
	// the resurfacing nudge (text, then the association line beneath), all on
	// the shared item row; purely presentational, the Day view owns every write.

	import type { Association, Task } from "../../types";
	import type { ResolvedAssociation } from "../../association";
	import TaskCheckbox from "../task/TaskCheckbox.svelte";
	import AssocMeta from "../components/AssocMeta.svelte";
	import ItemRow from "../components/ItemRow.svelte";
	import ItemText from "../components/ItemText.svelte";

	interface Props {
		task: Task;
		/** The task's explicit-or-inherited association, for the line beneath. */
		association?: Association;
		resolved?: ResolvedAssociation;
		/** The day it was left on ("Mon, Oct 19"), for the tooltips. */
		fromLabel: string;
		onDone: () => void;
		onCancel: () => void;
		onBring: () => void;
		onNavigate?: (assoc: Association) => void;
		/** A short label for where the row came from ("Mon"), shown
		 *  at the right so Inbox rows from yesterday read apart from backlog ones. */
		sourceTag?: string;
	}

	let { task, association, resolved, fromLabel, onDone, onCancel, onBring, onNavigate, sourceTag }: Props =
		$props();

	const assocLabel = $derived(resolved?.displayName || association?.id || "");
	const canNavigate = $derived(!!(association && resolved?.resolved && onNavigate));
</script>

{#snippet checkbox()}
	<TaskCheckbox
		status={task.status}
		color={resolved?.color}
		label={`Mark done on ${fromLabel}`}
		onToggle={onDone}
		{onCancel}
	/>
{/snippet}

{#snippet buttons()}
	<!-- Dismiss: cancelled where it was left, as a long-press on the box. -->
	<button
		class="leftover-bring leftover-dismiss"
		aria-label="Cancel it"
		onclick={(e) => {
			e.stopPropagation();
			onCancel();
		}}
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
	</button>
	<!-- No title: Obsidian already shows the aria-label as the tooltip. -->
	<button
		class="leftover-bring"
		aria-label="Bring to today"
		onclick={(e) => {
			e.stopPropagation();
			onBring();
		}}
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
	</button>
{/snippet}

{#snippet assocLine()}
	{#if association}
		{@const assoc = association}
		<AssocMeta
			association={assoc}
			label={assocLabel}
			linked={canNavigate}
			onNavigate={onNavigate ? () => onNavigate(assoc) : undefined}
		/>
	{/if}
{/snippet}

<ItemRow
	lead={checkbox}
	trail={buttons}
	tag={sourceTag ? { icon: "undo-2", text: sourceTag, title: `Left open on ${fromLabel}` } : undefined}
	meta={association ? assocLine : undefined}
>
	<ItemText text={task.text} sourcePath={task.source.path} />
</ItemRow>

<style>
	.leftover-bring {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		padding: 0;
		border-radius: 5px;
		background: transparent;
		box-shadow: none;
		color: var(--text-muted);
		cursor: pointer;
	}
	.leftover-bring:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		box-shadow: none;
	}
	/* Dismissing is the quieter answer: faint, and no accent on hover. */
	.leftover-dismiss {
		color: var(--text-faint);
	}
	.leftover-dismiss:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
</style>
