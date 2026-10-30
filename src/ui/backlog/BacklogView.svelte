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
	import { tooltip } from "../actions/tooltip";
	import {
		filterBySchedule,
		groupBacklog,
		type BacklogGroup,
		type BacklogSchedule,
		type BacklogSort,
	} from "../../backlogModel";
	import { dateFromISO, isoFromDate, todayISO } from "../../dayNote";
	import { nextDraftLine } from "../../draftLine";
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import AssocGroup from "../timeline/AssocGroup.svelte";
	import { createAssociation } from "../association/createAssociation";
	import Datepicker from "../components/Datepicker.svelte";
	import ItemRow from "../components/ItemRow.svelte";
	import ItemText from "../components/ItemText.svelte";

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
	// Show everything, only entries waiting on a resurface date, or only those
	// with none. View state, not persisted — it's a way of looking, not a setting.
	let schedule = $state<BacklogSchedule>("all");

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
		const scoped = filterBySchedule(entries, schedule);
		if (!filter) return scoped;
		const names = new Set(filter.names);
		return scoped.filter((e) => entryMatchesFilter(e, names));
	});

	const groups = $derived<BacklogGroup[]>(groupBacklog(visibleEntries, resolve, sort));

	// ── Entry identity ──
	// Entries have no persistent id; a source line uniquely names one within the
	// current parse. Every mutation matches on it, mirroring the writer's discipline.
	function sameEntry(a: BacklogEntry, b: BacklogEntry): boolean {
		return a.source.line === b.source.line;
	}

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
			// A unique negative line per freshly-created entry, from the plugin-wide
			// allocator: a local counter restarts at its seed on every mount, and a
			// repeated line collides as a duplicate key here and in "move to backlog".
			source: { path: settings.backlogPath, line: nextDraftLine() },
			text: "New item",
			...(assoc ? { assoc } : {}),
		};
		commit([...entries, draft]);
		// Only ask when the answer isn't already known. Creating inside a project
		// or domain group states the association by where you created it, so
		// prompting there asks a question the gesture just answered.
		if (settings.askAssocOnBacklogCreate && !assoc) {
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
	function stopEdit(entry: BacklogEntry) {
		if (isEditing(entry)) editingLine = null;
	}
	// `value` is already on one line (ItemText).
	function finishEdit(entry: BacklogEntry, value: string) {
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

	function cycleSchedule() {
		schedule =
			schedule === "all"
				? "scheduled"
				: schedule === "scheduled"
					? "unscheduled"
					: "all";
	}
	const scheduleLabel = $derived(
		schedule === "all"
			? "All"
			: schedule === "scheduled"
				? "Scheduled"
				: "Unscheduled",
	);

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
			title="Show all items, only scheduled ones (waiting on a resurface date), or only unscheduled ones"
			onclick={(e) => {
				e.stopPropagation();
				cycleSchedule();
			}}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
			<span>{scheduleLabel}</span>
		</button>
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
			{@const assoc = group.kind === "none"
				? undefined
				: { kind: group.kind, id: group.name }}
			<AssocGroup
				{assoc}
				resolved={assoc ? resolve(assoc) : undefined}
				count={group.entries.length}
				{onNavigate}
				noneLabel="Unassociated"
				onAdd={(anchor: DOMRect) => onCreate(group, anchor)}
				addLabel="Add a backlog item here"
			>

				{#if group.entries.length === 0}
					<div class="group-empty">Nothing here yet.</div>
				{:else}
					<ul class="entry-list">
						{#each group.entries as entry (entry.source.line)}
							<li class="entry-item">
								{#snippet bullet()}
									<span class="entry-bullet"></span>
								{/snippet}
								{#snippet actionBar()}
								<!-- Action bar — overlaid on top of the (full-width) text,
								     centred on the row's right edge. Woken from a triangle
								     against that edge (see actions/actionZone.ts), mirroring
								     the task row's action bar. A direct child of the row so
								     the shared zone styles apply. On a mouse wake it's a
								     vertical stack whose corner cell (delete) stays where the
								     bar's right end was, centred on the right edge, so the
								     "right" zone still fits; resurface, clear and associate
								     rise above it. Touch keeps the bar. -->
								<div class="entry-actions kairos-action-bar">
									<!-- Resurface date -->
									<button
										class="entry-action"
										class:active={entry.resurface}
										aria-label={entry.resurface ? "Change resurface date" : "Set a resurface date"}
										use:tooltip={entry.resurface ? "Change resurface date" : "Set a resurface date"}
										onclick={(e) => openResurface(entry, e)}
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
									</button>
									{#if entry.resurface}
										<button
											class="entry-action"
											aria-label="Clear resurface date"
											use:tooltip={"Clear resurface date"}
											onclick={(e) => clearResurface(entry, e)}
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m14 14-4 4"/><path d="m10 14 4 4"/></svg>
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
											aria-label="Associate with a project or domain"
											use:tooltip={"Associate with a project or domain"}
											onclick={(e) => openAssoc(entry, e)}
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
										</button>
									{:else}
										<button
											class="entry-action"
											aria-label="Change association"
											use:tooltip={"Change association"}
											onclick={(e) => openAssoc(entry, e)}
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
										</button>
									{/if}

									<!-- Delete -->
									<button
										class="entry-action entry-action-danger"
										aria-label="Delete item"
										use:tooltip={"Delete item"}
										onclick={(e) => { e.stopPropagation(); onDelete(entry); }}
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
									</button>
									</div>
								{/snippet}
								{#snippet resurfaceLine()}
									<!-- Resurface date shown as a metadata line under the item, on
									     the same shared `.kairos-meta` classes as the task row's
									     association line. It is always clickable, so `is-linked` is
									     unconditional. A due date stands out (orange); a future one
									     reads muted. -->
									{#if entry.resurface}
										<button
											class="entry-meta kairos-meta is-linked"
											class:is-due={isDue(entry.resurface)}
											title="Resurface date — click to change"
											onclick={(e) => openResurface(entry, e)}
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
											<span class="kairos-meta-label">
												{isDue(entry.resurface) ? "Resurfacing" : "Resurfaces"} {formatResurface(entry.resurface)}
											</span>
										</button>
									{/if}
								{/snippet}
								<ItemRow
									size="m"
									wraps
									zone={{ anchor: "right", layout: "stack" }}
									lead={bullet}
									actions={actionBar}
									meta={entry.resurface ? resurfaceLine : undefined}
								>
									<!-- Editing is the view's, not the row's: a new entry
									     opens straight into its editor. -->
									<ItemText
										text={entry.text}
										sourcePath={entry.source.path}
										lines={2}
										onCommit={(text) => finishEdit(entry, text)}
										bind:editing={
											() => isEditing(entry),
											(on) => (on ? startEdit(entry) : stopEdit(entry))
										}
									/>
								</ItemRow>

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
			</AssocGroup>
		{/each}
	</div>
</div>

{#if pickerEntry && pickerAnchor}
	<AssociationPicker
		options={index.associationOptions()}
		create={(kind, name) => createAssociation(index, kind, name)}
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
	/* Set like the Week, Grid and Timeline bars in the tab header, in
	   Obsidian's own type and buttons, since the Backlog sits in the sidebar
	   where there's no tab header to move into. */
	.backlog-header {
		display: flex;
		align-items: center;
		gap: 0;
		padding: var(--size-4-2) var(--size-4-2) var(--size-4-1) var(--size-4-3);
		flex-shrink: 0;
	}
	.backlog-title {
		margin-right: var(--size-4-2);
		font-size: var(--font-ui-medium);
		font-weight: var(--font-semibold);
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
	/* Frameless, like Obsidian's header buttons: a fill only on hover. */
	.sort-btn {
		display: flex;
		align-items: center;
		gap: var(--size-2-2);
		height: auto;
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-normal);
		color: var(--text-muted);
		background: transparent;
		border: none;
		border-radius: var(--clickable-icon-radius);
		box-shadow: none;
		padding: var(--size-2-2) var(--size-2-3);
		cursor: pointer;
	}
	.sort-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.sort-btn :global(svg) {
		width: var(--icon-xs);
		height: var(--icon-xs);
		stroke-width: var(--icon-stroke);
	}

	/* ── Scroll body ── */
	.backlog-scroll {
		flex: 1;
		overflow: auto;
		padding: 0 12px 16px;
	}

	/* ── Group ── */
	/* Groups are AssocGroup's, like the Day, Week and Grid lists: a bar in the
	   domain color down the group, the name in serif, the count and "+" on the
	   right. Here the heading stays in view while its entries scroll. */
	.backlog-scroll :global(.ag) {
		margin-top: 14px;
	}
	.backlog-scroll :global(.ag:first-child) {
		margin-top: 4px;
	}
	.backlog-scroll :global(.ag-head) {
		position: sticky;
		top: 0;
		z-index: 1;
		padding-top: 2px;
		background: var(--background-primary);
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
	/* The row is ItemRow (size "m"); the item holds it and its popups. */
	.entry-item {
		position: relative;
	}
	/* The lead: a dot in an 18px box, like a checkbox's. */
	.entry-bullet {
		width: 5px;
		height: 5px;
		margin: 6.5px;
		border-radius: 50%;
		background: var(--text-faint);
		flex-shrink: 0;
	}
	/* ── Resurface metadata line (under the item text) ── */
	/* Size, colour, hover and the orange due state come from the shared
	   `.kairos-meta` family in styles.css. All that is local is stripping the
	   default button chrome — this is the only metadata line in the plugin that
	   is a <button>, because clicking it reopens the datepicker. */
	.entry-meta {
		align-self: flex-start;
		padding: 0;
		margin: 0;
		border: none;
		box-shadow: none;
		background: transparent;
		height: min-content;
	}

	/* ── Action bar (resurface, associate, delete) ── */
	/* Overlaid on top of the full-width text, mirroring the task row's action
	   bar (same background + opacity); woken by actions/actionZone.ts. */
	.entry-actions {
		position: absolute;
		top: 50%;
		right: 8px;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		padding: 2px;
		border-radius: 4px;
		background: var(--background-primary);
		/* Shown/hidden by the shared .kairos-action-bar rules in styles.css. */
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
		box-shadow: none;
	}
	.entry-action.active {
		color: var(--text-normal);
	}
	.entry-action svg {
		flex-shrink: 0;
	}
	/* Stack layout (styles.css): delete takes the corner cell. */
	.entry-action-danger {
		order: -1;
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
