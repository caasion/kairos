<script lang="ts">
	// A routine due on a day but not in it yet, shown as a preview in the Grid.
	//
	// Modelled on BacklogNudge: where a task's checkbox would be, an ARROW adds
	// this one routine to the day. It is deliberately quieter than a real task —
	// a dashed outline, muted text and a repeat icon — because it isn't anything
	// yet: nothing is in the note until you pull it in. A block routine shows its
	// time; a task routine homed in a block names that block. The association
	// isn't repeated here, since the Grid row already says it. Purely
	// presentational: the parent owns the write.

	import type { Routine } from "../../routines/routinesFile";

	interface Props {
		routine: Routine;
		/** Row accent (domain color), if any. */
		color?: string;
		/** Add this routine to the day. */
		onInsert: (routine: Routine) => void;
	}

	let { routine, color, onInsert }: Props = $props();

	const accent = $derived(color || "var(--interactive-accent)");
	const text = $derived(routine.kind === "block" ? routine.title : routine.text);

	function hhmm(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}

	const detail = $derived(
		routine.kind === "block"
			? `${hhmm(routine.time.start)} – ${hhmm(routine.time.end)}`
			: routine.home
				? `in ${routine.home}`
				: "",
	);
</script>

<div
	class="routine-nudge"
	style={`--nudge-accent: ${accent};`}
	title="Routine — click the arrow to add it to this day"
>
	<div class="routine-nudge-row">
		<!-- The arrow replaces the checkbox: it adds the routine to the day. -->
		<button
			class="routine-nudge-insert"
			aria-label="Add to this day"
			title="Add to this day"
			onclick={(e) => {
				e.stopPropagation();
				onInsert(routine);
			}}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
		</button>
		<span class="routine-nudge-text">{text}</span>
		<span class="routine-nudge-icon" aria-hidden="true">
			<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
		</span>
	</div>
	{#if detail}
		<div class="routine-nudge-detail">{detail}</div>
	{/if}
</div>

<style>
	.routine-nudge {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 2px 4px;
		border-radius: 7px;
		min-width: 0;
		background: transparent;
		border: 1px dashed color-mix(in srgb, var(--nudge-accent) 45%, transparent);
	}
	.routine-nudge:hover {
		background: color-mix(in srgb, var(--nudge-accent) 8%, var(--background-primary));
	}

	.routine-nudge-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.routine-nudge-insert {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 18px;
		width: 18px;
		min-width: fit-content;
		flex-shrink: 0;
		padding: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--nudge-accent);
		cursor: pointer;
		box-shadow: none;
	}
	.routine-nudge-insert:hover {
		background: var(--nudge-accent);
		color: var(--text-on-accent);
		box-shadow: none;
	}

	.routine-nudge-text {
		flex: 1;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-muted);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.routine-nudge-icon {
		display: flex;
		flex-shrink: 0;
		color: var(--text-faint);
	}

	.routine-nudge-detail {
		/* Aligned under the text, past the 18px arrow and the row gap. */
		padding-left: 24px;
		font-size: 11px;
		line-height: 1.3;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
