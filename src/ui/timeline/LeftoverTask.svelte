<script lang="ts">
	// A task left open on an earlier day, offered in today's Day view (carry.ts,
	// decision 105). It still lives on that earlier day; this row only asks
	// what to do with it:
	//   • the checkbox marks it done where it is (a long-press cancels it), for
	//     the task you did but forgot to tick;
	//   • the arrow brings it to today's Unscheduled list.
	// Either way it drops out of the list. Presentation mirrors the task row and
	// the resurfacing nudge (text, then the association line beneath); purely
	// presentational, the Day view owns every write.

	import type { Association, Task } from "../../types";
	import type { ResolvedAssociation } from "../../association";
	import TaskCheckbox from "../task/TaskCheckbox.svelte";

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
		/** PROTOTYPE: a short label for where the row came from ("Mon"), shown
		 *  at the right so Inbox rows from yesterday read apart from backlog ones. */
		sourceTag?: string;
	}

	let { task, association, resolved, fromLabel, onDone, onCancel, onBring, onNavigate, sourceTag }: Props =
		$props();

	const assocLabel = $derived(resolved?.displayName || association?.id || "");
	const canNavigate = $derived(!!(association && resolved?.resolved && onNavigate));

	function clickAssoc(event: MouseEvent) {
		if (!association || !onNavigate) return;
		if (event.ctrlKey || event.metaKey) {
			event.stopPropagation();
			onNavigate(association);
		}
	}
</script>

<div class="leftover">
	<div class="leftover-row">
		<TaskCheckbox
			status={task.status}
			color={resolved?.color}
			label={`Mark done on ${fromLabel}`}
			onToggle={onDone}
			{onCancel}
		/>
		<span class="leftover-text" title={task.text}>{task.text}</span>
		{#if sourceTag}<span class="src-tag" title={`Left open on ${fromLabel}`}><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>{sourceTag}</span>{/if}
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
	</div>

	{#if association}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="kairos-meta-row is-indented">
			<div
				class="kairos-meta"
				class:is-linked={canNavigate}
				title={canNavigate ? "Ctrl+click to open" : undefined}
				onclick={clickAssoc}
			>
				{#if association.kind === "domain"}
					<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
				{/if}
				<span class="kairos-meta-label">{assocLabel}</span>
			</div>
		</div>
	{/if}
</div>

<style>
	/* PROTOTYPE: where an Inbox row came from, at the row's right. */
	.src-tag {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		font-size: var(--kairos-meta-font-size);
		color: var(--text-faint);
		white-space: nowrap;
	}
	.leftover {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 2px 4px;
		border-radius: 7px;
		min-width: 0;
	}
	.leftover:hover {
		background: var(--background-modifier-hover);
	}

	.leftover-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.leftover-text {
		flex: 1;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-normal);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

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
