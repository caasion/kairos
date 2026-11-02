<script lang="ts">
	// The inside of the "Add a change" / "Edit change" dialog (StatusRecordModal):
	// the record's fields as Obsidian's setting rows (StatusRecordForm), then
	// Obsidian's button row. Editing adds Delete on the left. It only collects
	// the record; the caller writes it.

	import type { LifecycleState, StatusRecord } from "../../types";
	import { dateFromISO, isoFromDate, todayISO } from "../../dayNote";
	import type { RecordDraft } from "./StatusRecordModal";
	import StatusRecordForm from "./StatusRecordForm.svelte";

	interface Props {
		/** The record being edited, or undefined to add one. */
		initial?: StatusRecord;
		states: LifecycleState[];
		onSave: (draft: RecordDraft) => void;
		onDelete?: () => void;
		onCancel: () => void;
	}

	let { initial, states, onSave, onDelete, onCancel }: Props = $props();

	// The dialog is made fresh for each record, so reading `initial` once is right.
	// svelte-ignore state_referenced_locally
	const start = initial;
	let date = $state<Date>(dateFromISO(start?.date ?? todayISO()));
	let status = $state<LifecycleState>(start?.status ?? "active");
	let note = $state(start?.note ?? "");
	let why = $state(start?.why ?? "");
	let intensity = $state(start?.intensity === undefined ? "" : String(start.intensity));

	function save() {
		onSave({
			date: isoFromDate(date),
			status,
			note: note.trim(),
			why: why.trim(),
			// Intensity belongs to an active stretch; the field is hidden otherwise.
			intensity: status === "active" && intensity !== "" ? Number(intensity) : undefined,
		});
	}
</script>

<StatusRecordForm
	bind:date
	bind:status
	bind:note
	bind:why
	bind:intensity
	{states}
	onSubmit={save}
/>
<div class="modal-button-container">
	{#if onDelete}
		<button class="mod-warning" onclick={onDelete}>Delete</button>
		<span class="kairos-record-spacer"></span>
	{/if}
	<button onclick={onCancel}>Cancel</button>
	<button class="mod-cta" onclick={save}>{initial ? "Save" : "Add change"}</button>
</div>

<style>
	.kairos-record-spacer {
		flex: 1;
	}
</style>
