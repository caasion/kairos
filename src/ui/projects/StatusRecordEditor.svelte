<script lang="ts">
	// One change in the status history, opened for editing in place (or a new
	// one being added at the top). Status is one click, the date opens the
	// calendar under it, intensity shows only while active, and intention and
	// why take the full width. Enter saves and Escape cancels from any field.
	// It only collects the record; ProjectDetail writes it.

	import type { LifecycleState, StatusRecord } from "../../types";
	import type { RecordDraft } from "./recordDraft";
	import { dateFromISO, isoFromDate, todayISO } from "../../dayNote";
	import { INTENSITY_MAX } from "../../projectFile";
	import Datepicker from "../components/Datepicker.svelte";
	import SegmentedControl from "../components/SegmentedControl.svelte";
	import { icon } from "../actions/icon";

	interface Props {
		/** The record being edited, or undefined to add one. */
		initial?: StatusRecord;
		states: LifecycleState[];
		onSave: (draft: RecordDraft) => void;
		onDelete?: () => void;
		onCancel: () => void;
	}

	let { initial, states, onSave, onDelete, onCancel }: Props = $props();

	const STATUS_LABEL: Record<LifecycleState, string> = {
		active: "Active",
		inactive: "Inactive",
		archived: "Archived",
	};
	const LEVELS = Array.from({ length: INTENSITY_MAX + 1 }, (_, i) => i);

	// Each editor is made fresh for one record, so reading `initial` once is right.
	// svelte-ignore state_referenced_locally
	const start = initial;
	let date = $state<Date>(dateFromISO(start?.date ?? todayISO()));
	let status = $state<LifecycleState>(start?.status ?? "active");
	let note = $state(start?.note ?? "");
	let why = $state(start?.why ?? "");
	let intensity = $state(start?.intensity === undefined ? "" : String(start.intensity));
	let picking = $state(false);

	function formatDate(d: Date): string {
		return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
	}

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

	function keys(e: KeyboardEvent) {
		if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
			e.preventDefault();
			save();
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			onCancel();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="kairos-record-editor" onkeydown={keys} onclick={(e) => e.stopPropagation()}>
	<div class="kairos-record-line">
		<SegmentedControl
			label="Status"
			options={states.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
			isOn={(s) => s === status}
			onSelect={(s) => (status = s as LifecycleState)}
		/>
		<button class="kairos-record-date" onclick={() => (picking = !picking)}>
			<span class="kairos-record-date-icon" use:icon={"calendar"}></span>
			{formatDate(date)}
		</button>
		{#if status === "active"}
			<select class="dropdown" aria-label="Intensity" bind:value={intensity}>
				<option value="">Intensity not set</option>
				{#each LEVELS as l (l)}
					<option value={String(l)}>Intensity {l} of {INTENSITY_MAX}</option>
				{/each}
			</select>
		{/if}
	</div>
	{#if picking}
		<div class="kairos-record-picker">
			<Datepicker inline bind:value={date} onselect={() => (picking = false)} />
		</div>
	{/if}
	<input type="text" placeholder="Intention: what you mean to do with it for now" bind:value={note} />
	<input type="text" placeholder="Why: what changed" bind:value={why} />
	<div class="kairos-record-buttons">
		{#if onDelete}
			<button class="mod-warning" onclick={onDelete}>Delete</button>
		{/if}
		<span class="kairos-record-spacer"></span>
		<button onclick={onCancel}>Cancel</button>
		<button class="mod-cta" onclick={save}>{initial ? "Save" : "Add change"}</button>
	</div>
</div>

<style>
	.kairos-record-editor {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
		width: 100%;
		cursor: default;
	}
	.kairos-record-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--size-4-2);
	}
	.kairos-record-date {
		display: inline-flex;
		align-items: center;
		gap: var(--size-4-1);
	}
	.kairos-record-date-icon {
		--icon-size: var(--icon-xs);
		display: flex;
	}
	.kairos-record-picker {
		display: flex;
	}
	.kairos-record-editor input[type="text"] {
		width: 100%;
	}
	.kairos-record-buttons {
		display: flex;
		gap: var(--size-4-2);
	}
	.kairos-record-spacer {
		flex: 1;
	}
</style>
