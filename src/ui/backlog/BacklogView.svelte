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
	import { navigateToAssociation } from "../../navigate";
	import {
		groupBacklog,
		type BacklogGroup,
		type BacklogSort,
	} from "../../backlogModel";
	import { dateFromISO, isoFromDate, todayISO } from "../../dayNote";
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import Datepicker from "../components/Datepicker.svelte";

	interface BacklogFilter {
		names: string[];
		label: string;
		nonce: number;
	}

	interface Props {
		app: App;
		index: KairosIndex;
		settings$: Readable<KairosSettings>;
		filter$: Readable<BacklogFilter | null>;
	}

	let { app, index, settings$, filter$ }: Props = $props();
	const settings = $derived($settings$);

	// ── The backlog feed ──
	let entries = $state<BacklogEntry[]>([]);
	let resolve = $state<Resolver>(() => ({ displayName: "", resolved: false }));
	let sort = $state<BacklogSort>("manual");

	// ── Project/domain filter (pushed by the Projects & Domains page) ──
	// An allow-list of association names; only entries whose association resolves
	// to (or literally names) one of them are shown. Matched against both the raw
	// tag id and its resolved display name so aliases still hit. Cleared on a plain
	// Backlog open.
	let filter = $state<BacklogFilter | null>(null);

	function entryMatchesFilter(entry: BacklogEntry, names: Set<string>): boolean {
		if (!entry.assoc) return false; // a name filter can't match an unassociated entry
		if (names.has(entry.assoc.id)) return true;
		const display = resolve(entry.assoc).displayName;
		return display !== "" && names.has(display);
	}

	const visibleEntries = $derived.by(() => {
		if (!filter) return entries;
		const names = new Set(filter.names);
		return entries.filter((e) => entryMatchesFilter(e, names));
	});

	const groups = $derived<BacklogGroup[]>(groupBacklog(visibleEntries, resolve, sort));

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

	function onCreate(group: BacklogGroup, anchor: DOMRect) {
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
		if (settings.askAssocOnBacklogCreate) {
			// Ask first: the picker owns the focus, so text editing has to wait
			// until it closes (answered or dismissed) — see `editAfterPick`.
			pickerEntry = draft;
			pickerAnchor = anchor;
			editAfterPick = draft.source.line;
			return;
		}
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

	// Scheduling an entry into a day is no longer done from here: an entry with a
	// resurface date surfaces as a nudge in the Day/Grid view on its due day, and
	// the user inserts it there. The backlog view owns capture + resurface only.

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
	// Set when the picker was opened automatically on a fresh draft: the line to
	// drop into text editing once the picker closes, answered or not.
	let editAfterPick: number | null = null;

	function openAssoc(entry: BacklogEntry, event: MouseEvent) {
		event.stopPropagation();
		pickerEntry = entry;
		pickerAnchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
	}
	function closeAssoc() {
		pickerEntry = null;
		pickerAnchor = null;
		if (editAfterPick !== null) {
			editingLine = editAfterPick;
			editAfterPick = null;
		}
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

	// ── Dismiss popups on outside click ──
	function handleClickOutside() {
		closeResurface();
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
		const unsubFilter: Unsubscriber = filter$.subscribe((f) => {
			filter = f;
		});
		return () => {
			unsubBacklog();
			unsubResolver();
			unsubFilter();
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backlog-view" onclick={handleClickOutside}>
	<div class="backlog-header">
		<span class="backlog-title">Backlog</span>
		{#if filter}
			<button
				class="filter-pill"
				title="Filtered to {filter.label} — click to clear"
				onclick={(e) => { e.stopPropagation(); filter = null; }}
			>
				<span>{filter.label}</span>
				<span class="filter-x">×</span>
			</button>
		{/if}
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
						<!-- Icon distinguishes a domain from a project, matching the
						     association-tag icons used in the grid & timeline views. -->
						<span class="group-kind-icon" title={group.kind === "domain" ? "Domain" : "Project"}>
							{#if group.kind === "domain"}
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
							{/if}
						</span>
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
							onCreate(
								group,
								e.currentTarget.getBoundingClientRect(),
							);
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
								<div class="entry-main">
									<span class="entry-bullet"></span>

									{#if isEditing(entry)}
										<!-- svelte-ignore a11y_autofocus -->
										<!-- Styled to be indistinguishable from the static text
										     (no box, no border) so editing feels like typing in
										     place — same discipline as the task row. -->
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

								<!-- Hover action bar — rectangular, revealed on row hover,
								     mirroring the task row's action bar. -->
								<div class="entry-actions">
									<!-- Resurface date -->
									<button
										class="entry-action"
										class:active={entry.resurface}
										title={entry.resurface ? "Resurface date — click to change" : "Set a resurface date"}
										aria-label="Resurface date"
										onclick={(e) => openResurface(entry, e)}
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
									</button>
									{#if entry.resurface}
										<button
											class="entry-action"
											title="Clear resurface date"
											aria-label="Clear resurface date"
											onclick={(e) => clearResurface(entry, e)}
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
										</button>
									{/if}

									<!-- Association. Once an entry is grouped under a project/
									     domain the tag is redundant, so we only offer to add one
									     when the entry is unassociated; re-associating an
									     associated entry stays available via the context of its
									     group. -->
									{#if !entry.assoc}
										<button
											class="entry-action"
											title="Associate with a project or domain"
											aria-label="Associate"
											onclick={(e) => openAssoc(entry, e)}
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
										</button>
									{:else}
										<button
											class="entry-action"
											title="Change association"
											aria-label="Change association"
											onclick={(e) => openAssoc(entry, e)}
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
										</button>
									{/if}

									<!-- Delete -->
									<button
										class="entry-action entry-action-danger"
										title="Delete item"
										aria-label="Delete"
										onclick={(e) => { e.stopPropagation(); onDelete(entry); }}
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
									</button>
									</div>
								</div>

								<!-- Resurface date shown as a metadata line under the item,
								     mirroring the task row's association line. A due date
								     stands out (orange); a future one reads muted. -->
								{#if entry.resurface}
									<button
										class="entry-meta"
										class:due={isDue(entry.resurface)}
										title="Resurface date — click to change"
										onclick={(e) => openResurface(entry, e)}
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
										<span class="entry-meta-label">
											{isDue(entry.resurface) ? "Resurfacing" : "Resurfaces"} {formatResurface(entry.resurface)}
										</span>
									</button>
								{/if}

								<!-- Popups anchored to this row -->
								{#if resurfaceEntry && sameEntry(resurfaceEntry, entry)}
									<div class="popup datepicker-popup" onclick={(e) => e.stopPropagation()}>
										<Datepicker inline bind:value={resurfaceValue} onselect={onResurfaceSelect} />
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
	.filter-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 22px;
		padding: 0 8px;
		margin-left: 8px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-on-accent);
		background: var(--interactive-accent);
		border: none;
		border-radius: 11px;
		cursor: pointer;
	}
	.filter-x {
		font-size: 14px;
		line-height: 1;
		opacity: 0.85;
	}
	.filter-pill:hover .filter-x {
		opacity: 1;
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
	.group-kind-icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
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
		min-width: min-content;
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
		flex-direction: column;
		gap: 1px;
		padding: 5px 8px;
		border-radius: 7px;
		position: relative;
	}
	.entry-row:hover {
		background: var(--background-modifier-hover);
	}
	.entry-main {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.entry-bullet {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--text-faint);
		flex-shrink: 0;
		margin: 0 3px;
	}
	/* The text button and the edit input are styled identically so clicking to
	   edit feels like putting the cursor on the item name — no box, no border,
	   no box-shadow (Obsidian's default button shadow is explicitly killed). */
	.entry-text {
		min-width: 0;
		font-size: 13px;
		line-height: 1.4;
		height: min-content;
		color: var(--text-normal);
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
		margin: 0;
		cursor: text;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.entry-input {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		line-height: 1.4;
		font-family: inherit;
		color: var(--text-normal);
		background: transparent;
		border: none;
		border-radius: 0;
		box-shadow: none;
		outline: none;
		padding: 0;
		margin: 0;
	}
	.entry-input:focus,
	.entry-input:focus-visible {
		border: none;
		box-shadow: none;
		outline: none;
	}
	.entry-spacer {
		flex: 1;
	}

	/* ── Resurface metadata line (under the item text) ── */
	/* Modeled on the task row's association line: a small, muted line indented to
	   sit under the text (past the bullet). A due date stands out in orange. It's
	   a button so clicking it reopens the datepicker. No default button chrome. */
	.entry-meta {
		display: flex;
		align-items: center;
		gap: 3px;
		align-self: flex-start;
		padding: 0 0 0 16px;
		margin: 0;
		border: none;
		box-shadow: none;
		background: transparent;
		font-size: 10px;
		color: var(--text-muted);
		cursor: pointer;
		min-width: 0;
		max-width: 100%;
		height: min-content;
	}
	.entry-meta:hover .entry-meta-label {
		text-decoration: underline;
	}
	.entry-meta.due {
		color: var(--color-orange, var(--interactive-accent));
	}
	.entry-meta svg {
		flex-shrink: 0;
	}
	.entry-meta-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Hover action bar (resurface, associate, delete) ── */
	/* Revealed only on row hover, mirroring the task row. Rectangular-ish and
	   free of Obsidian's default button box-shadow. */
	.entry-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity 0.1s;
	}
	.entry-row:hover .entry-actions {
		opacity: 1;
	}
	.entry-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 4px;
		box-shadow: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.entry-action:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.entry-action.active {
		color: var(--text-normal);
	}
	.entry-action svg {
		flex-shrink: 0;
	}
	.entry-action-danger:hover {
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
</style>
