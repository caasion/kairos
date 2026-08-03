<script lang="ts">
	// The Backlog view — a flat, global scratchpad of unscheduled intentions
	// grouped by association (spec §5, §2.6). Entries are NOT tasks: no checkbox.
	//
	// Layout: one group per project/domain an entry is tagged with, plus a always-
	// present "Unassociated" group (spec §2.3). Each entry shows its text, an
	// association chip, and a resurface (snooze) date. You can create, edit, delete,
	// re-associate, set a resurface date, and *schedule* an entry into a day.
	//
	// Data comes from the index's reactive `backlog()` store; grouping/sorting is
	// pure (backlogModel.ts). This component owns the picker/datepicker popups and
	// routes every mutation back through the index: entry edits via
	// `applyBacklogEdit`, scheduling via `scheduleEntry`. It never parses or writes
	// markdown itself — that all lives behind the index, exactly like the Grid view.

	import type { App } from "obsidian";
	import { onMount } from "svelte";
	import type { Readable, Unsubscriber } from "svelte/store";
	import type { KairosSettings } from "../../settings";
	import type { Association, BacklogEntry, ISODate } from "../../types";
	import type { KairosIndex, Resolver } from "../../index";
	import { addTaskToUnscheduled } from "../../writer";
	import { navigateToAssociation } from "../../navigate";
	import {
		groupBacklog,
		type BacklogGroup,
		type BacklogSort,
	} from "../../backlogModel";
	import {
		dateFromISO,
		ensureNoteForDate,
		isoFromDate,
		todayISO,
	} from "../../dayNote";
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import Datepicker from "../components/Datepicker.svelte";

	interface Props {
		app: App;
		index: KairosIndex;
		settings$: Readable<KairosSettings>;
	}

	let { app, index, settings$ }: Props = $props();
	const settings = $derived($settings$);

	// ── The backlog feed ──
	let entries = $state<BacklogEntry[]>([]);
	let resolve = $state<Resolver>(() => ({ displayName: "", resolved: false }));
	let sort = $state<BacklogSort>("manual");

	const groups = $derived<BacklogGroup[]>(groupBacklog(entries, resolve, sort));

	// ── Entry identity ──
	// Entries have no persistent id; a source line uniquely names one within the
	// current parse. Every mutation matches on it, mirroring the writer's discipline.
	function sameEntry(a: BacklogEntry, b: BacklogEntry): boolean {
		return a.source.line === b.source.line;
	}

	// A unique negative line per freshly-created entry so keyed rendering doesn't
	// collide before the reparse re-derives real lines.
	let nextDraftLine = -1;

	// ── Entry mutations (all route through applyBacklogEdit) ──

	function commit(next: BacklogEntry[]) {
		index.applyBacklogEdit(next);
	}

	function onCreate(group: BacklogGroup) {
		const assoc =
			group.kind === "none"
				? undefined
				: ({ kind: group.kind, id: group.name } as Association);
		const draft: BacklogEntry = {
			source: { path: settings.backlogPath, line: nextDraftLine-- },
			text: "New item",
			...(assoc ? { assoc } : {}),
		};
		commit([...entries, draft]);
		// Focus the new entry for immediate editing on the next render.
		editingLine = draft.source.line;
	}

	function onSetText(entry: BacklogEntry, text: string) {
		const trimmed = text.trim();
		if (trimmed === "") {
			onDelete(entry);
			return;
		}
		commit(entries.map((e) => (sameEntry(e, entry) ? { ...e, text: trimmed } : e)));
	}

	function onDelete(entry: BacklogEntry) {
		commit(entries.filter((e) => !sameEntry(e, entry)));
	}

	function onSetAssoc(entry: BacklogEntry, assoc: Association | null) {
		commit(
			entries.map((e) => {
				if (!sameEntry(e, entry)) return e;
				if (assoc) return { ...e, assoc };
				const { assoc: _drop, ...rest } = e;
				return rest;
			}),
		);
	}

	function onSetResurface(entry: BacklogEntry, resurface: ISODate | null) {
		commit(
			entries.map((e) => {
				if (!sameEntry(e, entry)) return e;
				if (resurface) return { ...e, resurface };
				const { resurface: _drop, ...rest } = e;
				return rest;
			}),
		);
	}

	function onNavigate(assoc: Association) {
		navigateToAssociation(app, resolve(assoc));
	}

	// ── Schedule an entry into a day (spec §2.6) ──
	// Removes the entry from the backlog and drops a task into the chosen day's
	// Unscheduled block, carrying the association forward. The engine commits both
	// files as one optimistic unit.

	async function onSchedule(entry: BacklogEntry, date: ISODate) {
		const path = await ensureNoteForDate(date);
		index.scheduleEntry(entry, date, path, (blocks) =>
			addTaskToUnscheduled(blocks, path, entry.text, entry.assoc, nextDraftLine--),
		);
		closeSchedule();
	}

	// ── Inline text editing ──
	let editingLine = $state<number | null>(null);

	function startEdit(entry: BacklogEntry) {
		editingLine = entry.source.line;
	}
	function isEditing(entry: BacklogEntry): boolean {
		return editingLine === entry.source.line;
	}
	function finishEdit(entry: BacklogEntry, value: string) {
		editingLine = null;
		if (value !== entry.text) onSetText(entry, value);
	}

	// ── Association picker (parent-owned so it isn't clipped) ──
	let pickerEntry = $state<BacklogEntry | null>(null);
	let pickerAnchor = $state<DOMRect | null>(null);

	function openAssoc(entry: BacklogEntry, event: MouseEvent) {
		event.stopPropagation();
		pickerEntry = entry;
		pickerAnchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
	}
	function closeAssoc() {
		pickerEntry = null;
		pickerAnchor = null;
	}
	function onPickAssoc(assoc: Association | null) {
		const entry = pickerEntry;
		closeAssoc();
		if (entry) onSetAssoc(entry, assoc);
	}

	// ── Resurface datepicker popup ──
	let resurfaceEntry = $state<BacklogEntry | null>(null);
	let resurfaceValue = $state<Date>(dateFromISO(todayISO()));

	function openResurface(entry: BacklogEntry, event: MouseEvent) {
		event.stopPropagation();
		resurfaceEntry = entry;
		resurfaceValue = dateFromISO(entry.resurface ?? todayISO());
	}
	function closeResurface() {
		resurfaceEntry = null;
	}
	function onResurfaceSelect(picked: Date) {
		const entry = resurfaceEntry;
		closeResurface();
		if (entry) onSetResurface(entry, isoFromDate(picked));
	}
	function clearResurface(entry: BacklogEntry, event: MouseEvent) {
		event.stopPropagation();
		onSetResurface(entry, null);
	}

	// ── Schedule datepicker popup ──
	let scheduleEntryTarget = $state<BacklogEntry | null>(null);
	let scheduleValue = $state<Date>(dateFromISO(todayISO()));

	function openSchedule(entry: BacklogEntry, event: MouseEvent) {
		event.stopPropagation();
		scheduleEntryTarget = entry;
		scheduleValue = dateFromISO(todayISO());
	}
	function closeSchedule() {
		scheduleEntryTarget = null;
	}
	function onScheduleSelect(picked: Date) {
		const entry = scheduleEntryTarget;
		if (entry) void onSchedule(entry, isoFromDate(picked));
	}

	// ── Dismiss popups on outside click ──
	function handleClickOutside() {
		closeResurface();
		closeSchedule();
	}

	function formatResurface(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	}

	// A resurface date at or before today is "due" — surfaced, styled to stand out.
	function isDue(date: ISODate): boolean {
		return date <= todayISO();
	}

	function cycleSort() {
		sort = sort === "manual" ? "resurface" : sort === "resurface" ? "alpha" : "manual";
	}
	const sortLabel = $derived(
		sort === "manual" ? "Manual" : sort === "resurface" ? "Resurface" : "A–Z",
	);

	onMount(() => {
		const unsubBacklog: Unsubscriber = index.backlog().subscribe((e) => {
			entries = e;
		});
		const unsubResolver: Unsubscriber = index.resolver().subscribe((r) => {
			resolve = r;
		});
		return () => {
			unsubBacklog();
			unsubResolver();
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backlog-view" onclick={handleClickOutside}>
	<div class="backlog-header">
		<span class="backlog-title">Backlog</span>
		<span class="backlog-header-spacer"></span>
		<button
			class="sort-btn"
			title="Change sort order"
			onclick={(e) => {
				e.stopPropagation();
				cycleSort();
			}}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/></svg>
			<span>{sortLabel}</span>
		</button>
	</div>

	<div class="backlog-scroll">
		{#each groups as group (group.key)}
			<section class="backlog-group">
				<header class="group-header">
					{#if group.kind !== "none"}
						<span
							class="group-accent"
							style={`background-color: ${group.color || "var(--text-faint)"};`}
						></span>
					{/if}
					<span class="group-name" class:unassociated={group.kind === "none"}
						>{group.name}</span
					>
					<span class="group-count">{group.entries.length}</span>
					<button
						class="add-btn"
						title="Add a backlog item here"
						onclick={(e) => {
							e.stopPropagation();
							onCreate(group);
						}}
						aria-label="Add item"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
					</button>
				</header>

				{#if group.entries.length === 0}
					<div class="group-empty">Nothing here yet.</div>
				{:else}
					<ul class="entry-list">
						{#each group.entries as entry (entry.source.line)}
							<li class="entry-row">
								<span class="entry-bullet"></span>

								{#if isEditing(entry)}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class="entry-input"
										value={entry.text}
										autofocus
										onclick={(e) => e.stopPropagation()}
										onblur={(e) => finishEdit(entry, e.currentTarget.value)}
										onkeydown={(e) => {
											if (e.key === "Enter") e.currentTarget.blur();
											if (e.key === "Escape") {
												e.currentTarget.value = entry.text;
												e.currentTarget.blur();
											}
										}}
									/>
								{:else}
									<button class="entry-text" onclick={(e) => { e.stopPropagation(); startEdit(entry); }}>
										{entry.text}
									</button>
								{/if}

								<span class="entry-spacer"></span>

								<!-- Resurface date chip -->
								{#if entry.resurface}
									<button
										class="chip resurface-chip"
										class:due={isDue(entry.resurface)}
										title="Resurface date — click to change, ✕ to clear"
										onclick={(e) => openResurface(entry, e)}
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
										<span>{formatResurface(entry.resurface)}</span>
										<span
											class="chip-x"
											role="button"
											tabindex="-1"
											aria-label="Clear resurface date"
											onclick={(e) => clearResurface(entry, e)}>×</span
										>
									</button>
								{:else}
									<button
										class="chip chip-ghost"
										title="Set a resurface date"
										onclick={(e) => openResurface(entry, e)}
										aria-label="Set resurface date"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
									</button>
								{/if}

								<!-- Association chip -->
								<button
									class="chip assoc-chip"
									class:ghost={!entry.assoc}
									title={entry.assoc ? "Change association" : "Associate with a project or domain"}
									style={group.color ? `--chip-accent: ${group.color};` : ""}
									onclick={(e) => openAssoc(entry, e)}
								>
									{#if entry.assoc}
										{resolve(entry.assoc).displayName || entry.assoc.id}
									{:else}
										<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
									{/if}
								</button>

								<!-- Schedule into a day -->
								<button
									class="chip schedule-chip"
									title="Schedule into a day"
									onclick={(e) => openSchedule(entry, e)}
									aria-label="Schedule"
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
								</button>

								<!-- Delete -->
								<button
									class="chip delete-chip"
									title="Delete item"
									onclick={(e) => { e.stopPropagation(); onDelete(entry); }}
									aria-label="Delete"
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
								</button>

								<!-- Popups anchored to this row -->
								{#if resurfaceEntry && sameEntry(resurfaceEntry, entry)}
									<div class="popup datepicker-popup" onclick={(e) => e.stopPropagation()}>
										<Datepicker inline bind:value={resurfaceValue} onselect={onResurfaceSelect} />
									</div>
								{/if}
								{#if scheduleEntryTarget && sameEntry(scheduleEntryTarget, entry)}
									<div class="popup datepicker-popup" onclick={(e) => e.stopPropagation()}>
										<div class="popup-label">Schedule to which day?</div>
										<Datepicker inline bind:value={scheduleValue} onselect={onScheduleSelect} />
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</div>
</div>

{#if pickerEntry && pickerAnchor}
	<AssociationPicker
		options={index.associationOptions()}
		current={pickerEntry.assoc}
		anchor={pickerAnchor}
		onPick={onPickAssoc}
		onClose={closeAssoc}
	/>
{/if}

<style>
	.backlog-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	/* ── Header ── */
	.backlog-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 12px 8px;
		flex-shrink: 0;
	}
	.backlog-title {
		font-size: 14px;
		font-weight: 700;
		color: var(--text-normal);
	}
	.backlog-header-spacer {
		flex: 1;
	}
	.sort-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--background-primary-alt);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 4px 8px;
		cursor: pointer;
	}
	.sort-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	/* ── Scroll body ── */
	.backlog-scroll {
		flex: 1;
		overflow: auto;
		padding: 0 12px 16px;
	}

	/* ── Group ── */
	.backlog-group {
		margin-bottom: 14px;
	}
	.group-header {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 4px;
		position: sticky;
		top: 0;
		background: var(--background-primary);
		z-index: 1;
	}
	.group-accent {
		width: 3px;
		height: 15px;
		border-radius: 2px;
		flex-shrink: 0;
	}
	.group-name {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--text-normal);
	}
	.group-name.unassociated {
		color: var(--text-faint);
		font-style: italic;
		text-transform: none;
		letter-spacing: 0;
	}
	.group-count {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.add-btn {
		margin-left: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 22px;
		width: 22px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary-alt);
		color: var(--text-muted);
		cursor: pointer;
	}
	.add-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.group-empty {
		font-size: 12px;
		color: var(--text-faint);
		padding: 4px 12px 8px;
		font-style: italic;
	}

	/* ── Entry list ── */
	.entry-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.entry-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		border-radius: 7px;
		position: relative;
	}
	.entry-row:hover {
		background: var(--background-modifier-hover);
	}
	.entry-bullet {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--text-faint);
		flex-shrink: 0;
		margin: 0 3px;
	}
	.entry-text {
		font-size: 13px;
		color: var(--text-normal);
		background: transparent;
		border: none;
		padding: 2px 0;
		cursor: text;
		text-align: left;
	}
	.entry-input {
		font-size: 13px;
		color: var(--text-normal);
		background: var(--background-primary);
		border: 1px solid var(--interactive-accent);
		border-radius: 5px;
		padding: 2px 6px;
		min-width: 160px;
	}
	.entry-spacer {
		flex: 1;
	}

	/* ── Chips (association, resurface, schedule, delete) ── */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 7px;
		font-size: 11px;
		font-weight: 500;
		border: 1px solid var(--background-modifier-border);
		border-radius: 11px;
		background: var(--background-primary-alt);
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.chip:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.chip svg {
		flex-shrink: 0;
	}
	/* Icon-only chips are square-ish. */
	.chip-ghost,
	.schedule-chip,
	.delete-chip {
		padding: 0 6px;
	}

	/* Association chip picks up the domain accent when one applies. */
	.assoc-chip {
		border-color: color-mix(in srgb, var(--chip-accent, var(--background-modifier-border)) 55%, var(--background-modifier-border));
		color: var(--text-normal);
	}
	.assoc-chip.ghost {
		color: var(--text-faint);
	}

	.resurface-chip.due {
		border-color: var(--color-orange, var(--interactive-accent));
		color: var(--color-orange, var(--interactive-accent));
	}
	.chip-x {
		margin-left: 1px;
		font-size: 13px;
		line-height: 1;
		opacity: 0.6;
	}
	.chip-x:hover {
		opacity: 1;
	}

	.delete-chip:hover {
		border-color: var(--text-error, #e05555);
		color: var(--text-error, #e05555);
	}

	/* ── Popups ── */
	.popup {
		position: absolute;
		top: calc(100% + 4px);
		right: 8px;
		z-index: 100;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: var(--shadow-s);
	}
	.datepicker-popup {
		padding: 4px;
	}
	.popup-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		padding: 8px 10px 4px;
	}
</style>
