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
	// forwarded to the parent, which holds the day + index and persists.

	import { Menu } from "obsidian";
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
		/** Ctrl-click the association line → open its project/domain. */
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
	<!-- Hover action bar, floating top-right over the row — mirrors the task
	     row's action bar (revealed only on hover). Holds the snooze action. -->
	<div class="nudge-actions">
		<button
			class="nudge-action"
			title="Resurface later"
			aria-label="Resurface later"
			onclick={openSnoozeMenu}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
		</button>
	</div>

	<div class="nudge-row">
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
	</div>

	{#if entry.assoc}
		<!-- Association line beneath the text — icon + canonical name, aligned
		     under the text past the arrow, ctrl-click to open. Same as the task
		     row's association line. -->
		<div
			class="nudge-assoc"
			class:domain={entry.assoc.kind === "domain"}
			class:linked={canNavigate}
			title={canNavigate ? "Ctrl+click to open" : undefined}
			onclick={clickAssoc}
		>
			{#if entry.assoc.kind === "domain"}
				<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
			{/if}
			<span class="nudge-assoc-label">{assocLabel}</span>
		</div>
	{/if}
</div>

<style>
	.nudge {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 2px 4px;
		border-radius: 7px;
		position: relative;
		min-width: 0;
		/* ~10% accent tint so surfaced intentions are in-your-face. */
		background: color-mix(in srgb, var(--nudge-accent) 10%, var(--background-primary));
		border: 1px solid color-mix(in srgb, var(--nudge-accent) 22%, transparent);
	}
	.nudge:hover {
		background: color-mix(in srgb, var(--nudge-accent) 16%, var(--background-primary));
	}

	/* ── Row: arrow + text ── */
	.nudge-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
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
		box-shadow: none;
	}
	.nudge-insert:hover {
		background: var(--nudge-accent);
		color: var(--text-on-accent);
	}

	.nudge-text {
		flex: 1;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-normal);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		background: color-mix(in srgb, var(--nudge-accent) 10%, var(--background-primary));
		opacity: 0;
		transition: opacity 0.1s;
		z-index: 2;
	}
	.nudge:hover .nudge-actions {
		opacity: 0.96;
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
	}

	/* ── Association line (small text + icon under the text) ── */
	.nudge-assoc {
		display: flex;
		align-items: center;
		gap: 3px;
		padding-left: 24px; /* align under the text, past the 18px arrow + gap */
		font-size: 10px;
		color: var(--text-muted);
		min-width: 0;
	}

	.nudge-assoc.linked {
		cursor: pointer;
	}

	.nudge-assoc.linked:hover .nudge-assoc-label {
		text-decoration: underline;
	}

	.nudge-assoc svg {
		flex-shrink: 0;
	}

	.nudge-assoc-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
