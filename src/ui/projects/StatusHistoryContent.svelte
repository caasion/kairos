<script lang="ts">
	// The editable status-history log, mounted inside a native Obsidian modal
	// (StatusHistoryModal). The modal owns the chrome (backdrop, title, close);
	// this component owns the log itself: the list of records, inline edit of a
	// prior record's date/status/note, delete, and add-at-date. Every mutation
	// routes through the pure edit functions via projectActions (they own the
	// invariants) — the form is a guardrail, not a raw editor.
	//
	// The open row is re-resolved from the live `projectsDomains()` feed on every
	// edit (the feed republishes on each applyProjectEdit/applyDomainEdit), so the
	// list refreshes in place. Buttons use Obsidian's native classes (mod-cta /
	// mod-warning) so they match the rest of the app's modal styling.

	import { onMount } from "svelte";
	import type { Unsubscriber } from "svelte/store";
	import type {
		Domain,
		ISODate,
		LifecycleState,
		Project,
		StatusRecord,
	} from "../../types";
	import type { KairosIndex, ProjectsDomains } from "../../index";
	import {
		editDomainStatusRecord,
		editProjectStatusRecord,
		removeDomainStatusRecord,
		removeProjectStatusRecord,
		setDomainStatus,
		setProjectStatus,
	} from "../../projectActions";
	import { dateFromISO, isoFromDate, todayISO } from "../../dayNote";
	import Datepicker from "../components/Datepicker.svelte";

	interface Props {
		index: KairosIndex;
		path: string; // source.path of the open row
		isDomain: boolean;
	}

	let { index, path, isDomain }: Props = $props();

	const STATUS_LABEL: Record<LifecycleState, string> = {
		active: "Active",
		inactive: "Inactive",
		archived: "Archived",
	};

	// ── Live feed → resolve the open row (re-renders after every edit) ──
	let feed = $state<ProjectsDomains>({
		domains: [],
		projectsByDomain: new Map(),
		orphans: [],
	});
	onMount(() => {
		const unsub: Unsubscriber = index.projectsDomains().subscribe((f) => {
			feed = f;
		});
		return () => unsub();
	});

	const row = $derived.by<Project | Domain | null>(() => {
		if (isDomain) return feed.domains.find((d) => d.source.path === path) ?? null;
		for (const list of feed.projectsByDomain.values()) {
			const hit = list.find((p) => p.source.path === path);
			if (hit) return hit;
		}
		return feed.orphans.find((p) => p.source.path === path) ?? null;
	});

	// The states offered when adding/editing a record: domains can't archive.
	const historyStates = $derived<LifecycleState[]>(
		isDomain ? ["active", "inactive"] : ["active", "inactive", "archived"],
	);

	// ── Add-a-record form ──
	let addDate = $state<Date>(dateFromISO(todayISO()));
	let addPickDate = $state(false);
	let addNote = $state("");

	function addStatusRecord(status: LifecycleState) {
		const e = row;
		if (!e) return;
		const date = isoFromDate(addDate);
		const note = addNote.trim();
		addNote = "";
		if (isDomain) setDomainStatus(index, e as Domain, date, status, note);
		else setProjectStatus(index, e as Project, date, status, note);
	}

	// ── Inline edit of a prior record ──
	let editingDate = $state<ISODate | null>(null); // record being edited (its original date)
	let editDate = $state<Date>(dateFromISO(todayISO()));
	let editStatus = $state<LifecycleState>("active");
	let editNote = $state("");
	let editPickDate = $state(false);

	function startEditRecord(rec: StatusRecord) {
		editingDate = rec.date;
		editDate = dateFromISO(rec.date);
		editStatus = rec.status;
		editNote = rec.note ?? "";
		editPickDate = false;
	}
	function commitEditRecord() {
		const e = row;
		if (!e || !editingDate) return;
		const next = { date: isoFromDate(editDate), status: editStatus, note: editNote.trim() };
		const original = editingDate;
		editingDate = null;
		if (isDomain) editDomainStatusRecord(index, e as Domain, original, next);
		else editProjectStatusRecord(index, e as Project, original, next);
	}
	function deleteRecord(date: ISODate) {
		const e = row;
		if (!e) return;
		if (editingDate === date) editingDate = null;
		if (isDomain) removeDomainStatusRecord(index, e as Domain, date);
		else removeProjectStatusRecord(index, e as Project, date);
	}

	function formatDate(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}
</script>

{#if row}
	{#if row.history.length === 0}
		<div class="history-empty">No status changes recorded — defaults to Active.</div>
	{:else}
		{@const today = todayISO()}
		{@const effective = row.history.filter((r) => r.date <= today).at(-1)}
		<ul class="history-list">
			{#each [...row.history].reverse() as rec (rec.date)}
				{@const isCurrent = rec === effective}
				{@const isFuture = rec.date > today}
				{#if editingDate === rec.date}
					<!-- Inline edit form for this record. -->
					<li class="history-item editing">
						<div class="history-edit-row">
							<button class="history-date-btn" onclick={() => (editPickDate = !editPickDate)}>
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
								<span>{formatDate(isoFromDate(editDate))}</span>
							</button>
							<select class="dropdown history-select" bind:value={editStatus}>
								{#each historyStates as s}
									<option value={s}>{STATUS_LABEL[s]}</option>
								{/each}
							</select>
						</div>
						{#if editStatus === "active"}
							<input
								class="history-note-input"
								placeholder="note (e.g. baseline / hard / taper)"
								bind:value={editNote}
								onkeydown={(e) => { if (e.key === "Enter") commitEditRecord(); }}
							/>
						{/if}
						{#if editPickDate}
							<div class="history-datepicker">
								<Datepicker inline bind:value={editDate} onselect={() => (editPickDate = false)} />
							</div>
						{/if}
						<div class="history-edit-actions">
							<button class="mod-cta" onclick={commitEditRecord}>Save</button>
							<button onclick={() => (editingDate = null)}>Cancel</button>
							<span class="history-spacer"></span>
							<button class="mod-warning" onclick={() => deleteRecord(rec.date)}>Delete</button>
						</div>
					</li>
				{:else}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<li class="history-item" class:current={isCurrent} onclick={() => startEditRecord(rec)} title="Click to edit">
						<span class="history-dot" class:active={rec.status === "active"}></span>
						<span class="history-status">{STATUS_LABEL[rec.status]}</span>
						{#if rec.note}<span class="history-note">{rec.note}</span>{/if}
						<span class="history-spacer"></span>
						<span class="history-date">{formatDate(rec.date)}</span>
						{#if isCurrent}<span class="history-badge">current</span>
						{:else if isFuture}<span class="history-badge">scheduled</span>{/if}
					</li>
				{/if}
			{/each}
		</ul>
	{/if}

	<!-- Add a new record. Editing/deleting a prior record is inline above
	     (click a row); invariants are enforced by the pure edit functions. -->
	<div class="history-add">
		<span class="history-add-label">Add change</span>
		<div class="history-add-row">
			<button class="history-date-btn" onclick={() => (addPickDate = !addPickDate)}>
				<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
				<span>{formatDate(isoFromDate(addDate))}</span>
			</button>
			<input
				class="history-note-input"
				placeholder="note (optional)"
				bind:value={addNote}
			/>
			<span class="history-spacer"></span>
			{#each historyStates as s}
				<button onclick={() => addStatusRecord(s)}>{STATUS_LABEL[s]}</button>
			{/each}
		</div>
		{#if addPickDate}
			<div class="history-datepicker">
				<Datepicker inline bind:value={addDate} onselect={() => (addPickDate = false)} />
			</div>
		{/if}
	</div>
{/if}

<style>
	.history-empty {
		font-size: 12px;
		color: var(--text-faint);
		font-style: italic;
		padding: 4px 0 10px;
	}
	.history-list {
		list-style: none;
		margin: 0 0 10px;
		padding: 0;
	}
	.history-spacer {
		flex: 1;
	}
	.history-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px;
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.history-item.current {
		font-weight: 600;
	}
	.history-item:not(.editing) {
		cursor: pointer;
	}
	.history-item:not(.editing):hover {
		background: var(--background-modifier-hover);
	}
	.history-item.editing {
		display: block;
		background: var(--background-secondary);
		border-radius: 6px;
		padding: 8px;
	}
	.history-note {
		font-size: 11px;
		color: var(--text-muted);
		font-style: italic;
		background: var(--background-modifier-border);
		border-radius: 4px;
		padding: 1px 6px;
	}
	.history-note-input {
		flex: 1;
		min-width: 0;
		height: 26px;
		padding: 0 8px;
		font-size: 11px;
	}
	.history-edit-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.history-select {
		height: 26px;
		font-size: 11px;
	}
	.history-item.editing .history-note-input {
		margin-top: 6px;
		width: 100%;
	}
	.history-edit-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
	}
	.history-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-faint);
		flex-shrink: 0;
	}
	.history-dot.active {
		background: var(--interactive-accent);
	}
	.history-status {
		font-size: 12px;
		color: var(--text-normal);
	}
	.history-date {
		font-size: 11px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.history-badge {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-on-accent);
		background: var(--interactive-accent);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.history-add {
		border-top: 1px solid var(--background-modifier-border);
		padding-top: 10px;
	}
	.history-add-label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-faint);
	}
	.history-add-row {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-top: 6px;
	}
	.history-date-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 26px;
		padding: 0 8px;
		font-size: 11px;
		cursor: pointer;
	}
	.history-datepicker {
		margin-top: 8px;
	}
</style>
