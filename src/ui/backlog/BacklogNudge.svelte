<script lang="ts">
	// A resurfaced backlog entry, shown as a nudge in the Day timeline and the
	// Grid (spec §2.6 as refined: resurfacing is a soft nudge, not a commitment).
	//
	// It looks like a task but is NOT one — where a task's checkbox would be, it
	// carries an ARROW that *inserts* the entry into the day (scheduleEntry),
	// turning it into a real task. You cannot check it; the only way "in" is the
	// arrow. Its background carries a ~10% accent tint so surfaced intentions are
	// deliberately in-your-face.
	//
	// Presentation deliberately mirrors the task row (Task.svelte): the text uses
	// the same font size, the association shows on its own line beneath the text
	// (icon + canonical name, ctrl-click to open), and the snooze action lives in
	// a hover-revealed action bar top-right — not a persistent chip. Purely
	// presentational: it owns no data and no writes; every action is an intent
	// forwarded to the parent, which holds the day + index and persists. Built
	// on the shared item row (ItemRow), tinted.

	import { Menu } from "obsidian";
	import type { Association, BacklogEntry } from "../../types";
	import type { ResolvedAssociation } from "../../association";
	import { tooltip } from "../actions/tooltip";
	import AssocMeta from "../components/AssocMeta.svelte";
	import ItemRow from "../components/ItemRow.svelte";
	import ItemText from "../components/ItemText.svelte";

	interface Props {
		entry: BacklogEntry;
		/** The entry's resolved association (name + optional domain color). */
		resolved?: ResolvedAssociation;
		/** Insert this entry into the day as a real task (the arrow). */
		onInsert: (entry: BacklogEntry) => void;
		/** Resurface tomorrow (today + 1). */
		onResurfaceTomorrow: (entry: BacklogEntry) => void;
		/** Open a datepicker to resurface at a chosen date; anchored to the rect. */
		onResurfaceAt: (entry: BacklogEntry, anchor: DOMRect) => void;
		/** Ctrl-click the association line → open its project/domain. */
		onNavigate?: (assoc: Association) => void;
		/** False when a group header above already names it. */
		showAssociation?: boolean;
		/** A short label for where the row came from ("Backlog"). */
		sourceTag?: string;
	}

	let {
		entry,
		resolved,
		onInsert,
		onResurfaceTomorrow,
		onResurfaceAt,
		onNavigate,
		showAssociation = true,
		sourceTag,
	}: Props = $props();

	const accent = $derived(resolved?.color || "var(--interactive-accent)");

	// Prefer the resolved canonical name (never an alias); fall back to the raw
	// tag id — same rule as the task row's association label.
	const assocLabel = $derived(resolved?.displayName || entry.assoc?.id || "");
	const canNavigate = $derived(!!(entry.assoc && resolved?.resolved && onNavigate));

	// The snooze button opens Obsidian's native context menu, so it looks and
	// behaves like every other menu in the app rather than a bespoke popup. The
	// "at date…" item still hands off to the parent's anchored datepicker.
	function openSnoozeMenu(event: MouseEvent) {
		event.stopPropagation();
		const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Resurface tomorrow")
				.setIcon("calendar-arrow-up")
				.onClick(() => onResurfaceTomorrow(entry)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Resurface at date…")
				.setIcon("calendar")
				.onClick(() => onResurfaceAt(entry, anchor)),
		);
		menu.showAtMouseEvent(event);
	}
</script>

{#snippet insert()}
	<!-- The arrow replaces the checkbox: it schedules the entry into the day. -->
	<button
		class="nudge-insert"
		title="Schedule into this day"
		aria-label="Schedule into this day"
		onclick={(e) => {
			e.stopPropagation();
			onInsert(entry);
		}}
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
	</button>
{/snippet}

{#snippet actionBar()}
	<!-- Action bar, floating top-right over the row — mirrors the task row's
	     action bar (woken from the top-right corner zone, see
	     actions/actionZone.ts). Holds the snooze action. Uses the stack layout
	     like every bar; with one button that's just the corner cell. -->
	<div class="nudge-actions kairos-action-bar">
		<button
			class="nudge-action"
			aria-label="Resurface later"
			use:tooltip={"Resurface later"}
			onclick={openSnoozeMenu}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
		</button>
	</div>
{/snippet}

{#snippet assocLine()}
	{#if entry.assoc}
		{@const assoc = entry.assoc}
		<AssocMeta
			association={assoc}
			label={assocLabel}
			linked={canNavigate}
			onNavigate={onNavigate ? () => onNavigate(assoc) : undefined}
		/>
	{/if}
{/snippet}

<ItemRow
	tinted
	color={accent}
	title="Resurfaced backlog item — click the arrow to schedule it into this day"
	zone={{ layout: "stack" }}
	lead={insert}
	actions={actionBar}
	tag={sourceTag ? { icon: "clock", text: sourceTag, title: "Resurfaced from the backlog" } : undefined}
	meta={entry.assoc && showAssociation ? assocLine : undefined}
>
	<ItemText text={entry.text} sourcePath={entry.source.path} />
</ItemRow>

<style>
	.nudge-insert {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 18px;
		width: 18px;
		min-width: fit-content;
		flex-shrink: 0;
		padding: 0px;
		border-radius: 5px;
		background: transparent;
		color: var(--kairos-link-color);
		cursor: pointer;
		box-shadow: none;
	}
	.nudge-insert:hover {
		background: var(--kairos-link-color);
		color: var(--text-on-accent);
		box-shadow: none;
	}

	/* ── Hover action bar (snooze) — mirrors the task row's action bar. ── */
	.nudge-actions {
		position: absolute;
		top: 0;
		right: 0;
		display: flex;
		gap: 2px;
		padding: 2px;
		/* Blend into the tinted nudge background so it reads through cleanly. */
		background: color-mix(in srgb, var(--kairos-link-color) 10%, var(--background-primary));
		z-index: 2;
		/* Shown/hidden by the shared .kairos-action-bar rules in styles.css. */
	}

	.nudge-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		box-shadow: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.nudge-action:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
		box-shadow: none;
	}
</style>
