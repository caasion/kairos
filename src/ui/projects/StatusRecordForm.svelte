<script lang="ts">
	// The fields of one status record (a change in a project's or domain's
	// status), laid out as Obsidian's own setting rows: name on the left,
	// control on the right. The status history dialog uses it both to add a
	// change and to edit one, so the two look and work the same.

	import type { LifecycleState } from "../../types";
	import { INTENSITY_MAX } from "../../projectFile";
	import { dateFromISO, isoFromDate } from "../../dayNote";
	import Datepicker from "../components/Datepicker.svelte";
	import { icon } from "../actions/icon";

	interface Props {
		date: Date;
		status: LifecycleState;
		note: string;
		why: string;
		/** "" is unset. */
		intensity: string;
		states: LifecycleState[];
		/** Enter in a text field. */
		onSubmit: () => void;
	}

	let {
		date = $bindable(),
		status = $bindable(),
		note = $bindable(),
		why = $bindable(),
		intensity = $bindable(),
		states,
		onSubmit,
	}: Props = $props();

	const STATUS_LABEL: Record<LifecycleState, string> = {
		active: "Active",
		inactive: "Inactive",
		archived: "Archived",
	};
	const LEVELS = Array.from({ length: INTENSITY_MAX + 1 }, (_, i) => i);

	let picking = $state(false);

	function formatDate(d: Date): string {
		return dateFromISO(isoFromDate(d)).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	function enter(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			onSubmit();
		}
	}
</script>

<div class="setting-item">
	<div class="setting-item-info"><div class="setting-item-name">Status</div></div>
	<div class="setting-item-control">
		<select class="dropdown" bind:value={status}>
			{#each states as s (s)}
				<option value={s}>{STATUS_LABEL[s]}</option>
			{/each}
		</select>
	</div>
</div>

<div class="setting-item">
	<div class="setting-item-info">
		<div class="setting-item-name">From</div>
		<div class="setting-item-description">The day the change took effect.</div>
	</div>
	<div class="setting-item-control">
		<button class="kairos-record-date" onclick={() => (picking = !picking)}>
			<span class="kairos-record-date-icon" use:icon={"calendar"}></span>
			{formatDate(date)}
		</button>
	</div>
</div>
{#if picking}
	<div class="kairos-record-picker">
		<Datepicker inline bind:value={date} onselect={() => (picking = false)} />
	</div>
{/if}

{#if status === "active"}
	<div class="setting-item">
		<div class="setting-item-info">
			<div class="setting-item-name">Intensity</div>
			<div class="setting-item-description">How hard you're pushing it, from 0 to {INTENSITY_MAX}.</div>
		</div>
		<div class="setting-item-control">
			<select class="dropdown" bind:value={intensity}>
				<option value="">Not set</option>
				{#each LEVELS as l (l)}
					<option value={String(l)}>{l}</option>
				{/each}
			</select>
		</div>
	</div>
{/if}

<div class="setting-item">
	<div class="setting-item-info">
		<div class="setting-item-name">Intention</div>
		<div class="setting-item-description">What you mean to do with it for now.</div>
	</div>
	<div class="setting-item-control">
		<input type="text" placeholder="Optional" bind:value={note} onkeydown={enter} />
	</div>
</div>

<div class="setting-item">
	<div class="setting-item-info">
		<div class="setting-item-name">Why</div>
		<div class="setting-item-description">What changed.</div>
	</div>
	<div class="setting-item-control">
		<input type="text" placeholder="Optional" bind:value={why} onkeydown={enter} />
	</div>
</div>

<style>
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
		justify-content: flex-end;
		padding-bottom: var(--size-4-2);
	}
</style>
