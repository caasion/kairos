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
	// Purely presentational: it owns no data and no writes. Every action is an
	// intent forwarded to the parent view, which holds the day + index and
	// persists. The parent supplies the resolved association for display/tint.

	import type { Association, BacklogEntry } from "../../types";
	import type { ResolvedAssociation } from "../../association";

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
		/** Ctrl-click the association chip → open its project/domain. */
		onNavigate?: (assoc: Association) => void;
	}

	let {
		entry,
		resolved,
		onInsert,
		onResurfaceTomorrow,
		onResurfaceAt,
		onNavigate,
	}: Props = $props();

	const accent = $derived(resolved?.color || "var(--interactive-accent)");

	let menuOpen = $state(false);
	let menuAnchor = $state<HTMLElement>();

	function toggleMenu(event: MouseEvent) {
		event.stopPropagation();
		menuAnchor = event.currentTarget as HTMLElement;
		menuOpen = !menuOpen;
	}
	function pickTomorrow(event: MouseEvent) {
		event.stopPropagation();
		menuOpen = false;
		onResurfaceTomorrow(entry);
	}
	function pickAtDate(event: MouseEvent) {
		event.stopPropagation();
		menuOpen = false;
		if (menuAnchor) onResurfaceAt(entry, menuAnchor.getBoundingClientRect());
	}

	function clickAssoc(event: MouseEvent) {
		if (!entry.assoc || !onNavigate) return;
		if (event.ctrlKey || event.metaKey) {
			event.stopPropagation();
			onNavigate(entry.assoc);
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="nudge"
	style={`--nudge-accent: ${accent};`}
	title="Resurfaced backlog item — click the arrow to schedule it into this day"
>
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

	<span class="nudge-text">{entry.text}</span>

	<span class="nudge-spacer"></span>

	{#if entry.assoc}
		<button
			class="nudge-assoc"
			title={onNavigate ? "Ctrl-click to open" : undefined}
			onclick={clickAssoc}
		>
			{resolved?.displayName || entry.assoc.id}
		</button>
	{/if}

	<!-- Resurface (snooze) menu. -->
	<button
		class="nudge-snooze"
		title="Resurface later"
		aria-label="Resurface later"
		onclick={toggleMenu}
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
	</button>

	{#if menuOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="snooze-menu" onclick={(e) => e.stopPropagation()}>
			<button class="snooze-item" onclick={pickTomorrow}>Resurface tomorrow</button>
			<button class="snooze-item" onclick={pickAtDate}>Resurface at date…</button>
		</div>
	{/if}
</div>

<svelte:window
	onclick={() => {
		if (menuOpen) menuOpen = false;
	}}
/>

<style>
	.nudge {
		display: flex;
		align-items: center;
		gap: 6px;
		border-radius: 7px;
		position: relative;
		/* ~10% accent tint so surfaced intentions are in-your-face. */
		background: color-mix(in srgb, var(--nudge-accent) 10%, var(--background-primary));
		border: 1px solid color-mix(in srgb, var(--nudge-accent) 22%, transparent);
	}
	.nudge:hover {
		background: color-mix(in srgb, var(--nudge-accent) 16%, var(--background-primary));
	}

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
		color: var(--nudge-accent);
		cursor: pointer;
	}
	.nudge-insert:hover {
		background: var(--nudge-accent);
		color: var(--text-on-accent);
	}

	.nudge-text {
		font-size: 13px;
		color: var(--text-normal);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nudge-spacer {
		flex: 1;
	}

	.nudge-assoc {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		background: transparent;
		border: none;
		padding: 0 2px;
		cursor: default;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.nudge-snooze {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 20px;
		width: 20px;
		flex-shrink: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--text-faint);
		cursor: pointer;
	}
	.nudge-snooze:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.snooze-menu {
		position: absolute;
		top: calc(100% + 2px);
		right: 4px;
		z-index: 100;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: var(--shadow-s);
		padding: 4px;
		display: flex;
		flex-direction: column;
		min-width: 160px;
	}
	.snooze-item {
		text-align: left;
		font-size: 12px;
		color: var(--text-normal);
		background: transparent;
		border: none;
		border-radius: 5px;
		padding: 6px 8px;
		cursor: pointer;
		white-space: nowrap;
	}
	.snooze-item:hover {
		background: var(--background-modifier-hover);
	}
</style>
