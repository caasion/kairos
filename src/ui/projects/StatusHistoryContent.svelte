<script lang="ts">
	// The editable status-history log, mounted inside a native Obsidian modal
	// (StatusHistoryModal). The modal owns the chrome (backdrop, title, close);
	// this component owns the log itself: the list of records, inline edit of a
	// prior record's date/status/note/why/intensity, delete, and add-at-date. A
	// record's `note` is the intention for that stretch and its `why` says what
	// moved the entity into it; both are freeform, and a record with no reason renders a muted
	// placeholder so the gaps are visible rather than invisible. Every mutation
	// routes through the pure edit functions via projectActions (they own the
	// invariants) — the form is a guardrail, not a raw editor.
	//
	// The open row is re-resolved from the live `projectsDomains()` feed on every
	// edit (the feed republishes on each applyProjectEdit/applyDomainEdit), so the
	// list refreshes in place. It's built from Obsidian's own parts (setting
	// rows, `modal-button-container`, mod-cta / mod-warning buttons) so it reads
	// like Obsidian's dialogs. The fields of a record are one form
	// (StatusRecordForm), used to add a change and to edit one.

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
	import { INTENSITY_MAX } from "../../projectFile";
	import IntensityBars from "../components/IntensityBars.svelte";
	import StatusRecordForm from "./StatusRecordForm.svelte";

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

	// "" is unset (no claim).
	const parseLevel = (v: string): number | undefined => (v === "" ? undefined : Number(v));

	// The states offered when adding/editing a record: domains can't archive.
	const historyStates = $derived<LifecycleState[]>(
		isDomain ? ["active", "inactive"] : ["active", "inactive", "archived"],
	);

	// ── Add-a-record form ──
	let addDate = $state<Date>(dateFromISO(todayISO()));
	let addStatus = $state<LifecycleState>("active");
	let addNote = $state("");
	let addWhy = $state("");
	let addIntensity = $state(""); // applies only when the added record is active

	function addStatusRecord() {
		const e = row;
		if (!e) return;
		const status = addStatus;
		const date = isoFromDate(addDate);
		const note = addNote.trim();
		const why = addWhy.trim();
		const intensity = status === "active" ? parseLevel(addIntensity) : undefined;
		addNote = "";
		addWhy = "";
		addIntensity = "";
		if (isDomain) setDomainStatus(index, e as Domain, date, status, note, why, intensity);
		else setProjectStatus(index, e as Project, date, status, note, why, intensity);
	}

	// ── Inline edit of a prior record ──
	let editingDate = $state<ISODate | null>(null); // record being edited (its original date)
	let editDate = $state<Date>(dateFromISO(todayISO()));
	let editStatus = $state<LifecycleState>("active");
	let editNote = $state("");
	let editWhy = $state("");
	let editIntensity = $state("");

	function startEditRecord(rec: StatusRecord) {
		editingDate = rec.date;
		editDate = dateFromISO(rec.date);
		editStatus = rec.status;
		editNote = rec.note ?? "";
		editWhy = rec.why ?? "";
		editIntensity = rec.intensity === undefined ? "" : String(rec.intensity);
	}
	function commitEditRecord() {
		const e = row;
		if (!e || !editingDate) return;
		// Note and why are always present: this form owns them, so an emptied
		// field clears the stored value rather than leaving the old one behind.
		// Intensity is owned only while the record is active (the select is hidden
		// otherwise), so an inactive edit leaves whatever is stored alone.
		const next = {
			date: isoFromDate(editDate),
			status: editStatus,
			note: editNote.trim(),
			why: editWhy.trim(),
			...(editStatus === "active" ? { intensity: parseLevel(editIntensity) } : {}),
		};
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
	<div class="setting-item setting-item-heading">
		<div class="setting-item-info"><div class="setting-item-name">History</div></div>
	</div>
	{#if row.history.length === 0}
		<p class="kairos-history-empty">No changes recorded yet, so it counts as active.</p>
	{:else}
		{@const today = todayISO()}
		{@const effective = row.history.filter((r) => r.date <= today).at(-1)}
		<ul class="kairos-history-list">
			{#each [...row.history].reverse() as rec (rec.date)}
				{@const isCurrent = rec === effective}
				{@const isFuture = rec.date > today}
				{#if editingDate === rec.date}
					<li class="kairos-history-edit">
						<StatusRecordForm
							bind:date={editDate}
							bind:status={editStatus}
							bind:note={editNote}
							bind:why={editWhy}
							bind:intensity={editIntensity}
							states={historyStates}
							onSubmit={commitEditRecord}
						/>
						<div class="modal-button-container">
							<button class="mod-warning" onclick={() => deleteRecord(rec.date)}>Delete</button>
							<span class="kairos-history-spacer"></span>
							<button onclick={() => (editingDate = null)}>Cancel</button>
							<button class="mod-cta" onclick={commitEditRecord}>Save</button>
						</div>
					</li>
				{:else}
					<li>
						<div
							class="kairos-history-row"
							role="button"
							tabindex="0"
							title="Edit this change"
							onclick={() => startEditRecord(rec)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									startEditRecord(rec);
								}
							}}
						>
							<span class="kairos-history-line">
								<span class="kairos-history-dot" data-status={rec.status}></span>
								<span class="kairos-history-status">{STATUS_LABEL[rec.status]}</span>
								{#if rec.status === "active" && rec.intensity !== undefined}
									<span class="kairos-history-intensity" title={`Intensity ${rec.intensity} of ${INTENSITY_MAX}`}>
										<IntensityBars level={rec.intensity} />
									</span>
								{/if}
								{#if isCurrent}<span class="kairos-history-when">Now</span>
								{:else if isFuture}<span class="kairos-history-when">Scheduled</span>{/if}
								<span class="kairos-history-spacer"></span>
								<span class="kairos-history-date">{formatDate(rec.date)}</span>
							</span>
							{#if rec.note}<span class="kairos-history-note">{rec.note}</span>{/if}
							<span class="kairos-history-why" class:none={!rec.why}>{rec.why || "No reason recorded"}</span>
						</div>
					</li>
				{/if}
			{/each}
		</ul>
	{/if}

	<div class="setting-item setting-item-heading">
		<div class="setting-item-info"><div class="setting-item-name">Add a change</div></div>
	</div>
	<StatusRecordForm
		bind:date={addDate}
		bind:status={addStatus}
		bind:note={addNote}
		bind:why={addWhy}
		bind:intensity={addIntensity}
		states={historyStates}
		onSubmit={addStatusRecord}
	/>
	<div class="modal-button-container">
		<button class="mod-cta" onclick={addStatusRecord}>Add change</button>
	</div>
{/if}

<style>
	.kairos-history-empty {
		margin: 0 0 var(--size-4-2);
		color: var(--text-muted);
	}
	.kairos-history-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.kairos-history-spacer {
		flex: 1;
	}
	/* A change reads like a line in Obsidian's lists: plain, with a hover fill,
	   and selecting it opens it for editing. */
	.kairos-history-row {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--size-2-1);
		padding: var(--size-4-2);
		border-radius: var(--radius-s);
		cursor: pointer;
	}
	.kairos-history-row:hover {
		background: var(--background-modifier-hover);
	}
	.kairos-history-line {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
	}
	.kairos-history-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--text-faint);
	}
	.kairos-history-dot[data-status="active"] {
		background: var(--color-green);
	}
	.kairos-history-dot[data-status="archived"] {
		background: var(--color-red);
	}
	.kairos-history-status {
		color: var(--text-normal);
		font-size: var(--font-ui-small);
	}
	.kairos-history-intensity {
		display: inline-flex;
		color: var(--text-muted);
	}
	.kairos-history-when {
		color: var(--text-accent);
		font-size: var(--font-ui-smaller);
	}
	.kairos-history-date {
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		font-variant-numeric: tabular-nums;
	}
	.kairos-history-note,
	.kairos-history-why {
		padding-left: calc(7px + var(--size-4-2));
		font-size: var(--font-ui-smaller);
		white-space: normal;
	}
	.kairos-history-note {
		color: var(--text-normal);
	}
	.kairos-history-why {
		color: var(--text-muted);
	}
	.kairos-history-why.none {
		color: var(--text-faint);
	}
	.kairos-history-edit {
		padding: 0 var(--size-4-2) var(--size-4-2);
		border-radius: var(--radius-m);
		background: var(--background-secondary);
	}
</style>
