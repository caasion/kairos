<script lang="ts">
	// A project's or domain's status history in the detail pane (ProjectDetail):
	// the strip to scale on top (StatusStrip), then the same history as a
	// timeline, newest first. The timeline alternates the two parts of every
	// record (statusStretches.ts). A stretch, on a bar in its status colour,
	// holds the status, intensity and intention; a transition, a diamond on the
	// rail, holds the date and the reason. The reason sits on the change it
	// explains, not on the state.
	//
	// Selecting either part, here or on the strip, opens just its fields for
	// editing in place (StatusRecordEditor). **Add change** opens all of them at
	// the top. Every write goes through projectActions, whose pure edit
	// functions own the history's invariants; editing one part passes only that
	// part's keys, so the other part's `why` or intensity is left as stored.

	import type { Domain, ISODate, LifecycleState, Project, StatusRecord } from "../../types";
	import type { KairosIndex } from "../../index";
	import {
		editDomainStatusRecord,
		editProjectStatusRecord,
		removeDomainStatusRecord,
		removeProjectStatusRecord,
		setDomainStatus,
		setProjectStatus,
	} from "../../projectActions";
	import type { StatusEdit } from "../../projectFile";
	import { INTENSITY_MAX } from "../../projectFile";
	import { dateFromISO, todayISO } from "../../dayNote";
	import { shiftDays } from "../../gantt/ganttUtils";
	import IntensityBars from "../components/IntensityBars.svelte";
	import Tag from "../components/Tag.svelte";
	import { icon } from "../actions/icon";
	import StatusRecordEditor from "./StatusRecordEditor.svelte";
	import StatusStrip from "./StatusStrip.svelte";
	import type { RecordDraft } from "./recordDraft";
	import { formatSpan, stretchesOf, stripOf, type Stretch } from "./statusStretches";

	interface Props {
		index: KairosIndex;
		entity: Project | Domain;
		isDomain: boolean;
		readonly: boolean;
	}

	let { index, entity, isDomain, readonly }: Props = $props();

	const STATUS_LABEL: Record<LifecycleState, string> = {
		active: "Active",
		inactive: "Inactive",
		archived: "Archived",
	};

	// Domains are durable: they never archive.
	const states = $derived<LifecycleState[]>(
		isDomain ? ["active", "inactive"] : ["active", "inactive", "archived"],
	);
	const today = $derived(todayISO());
	const stretches = $derived(stretchesOf(entity.history, today));
	const newestFirst = $derived([...stretches].reverse());
	const parts = $derived(stripOf(stretches, today));

	// The part open for editing, and whether a change is being added. One at a time.
	type Part = "stretch" | "transition";
	let open = $state<{ part: Part; date: ISODate } | null>(null);
	let adding = $state(false);

	function select(part: Part, date: ISODate) {
		if (readonly) return;
		adding = false;
		open = { part, date };
	}
	function isOpen(part: Part, s: Stretch): boolean {
		return open?.part === part && open.date === s.start;
	}

	function formatDate(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	function spanText(s: Stretch): string {
		if (s.future) return `from ${formatDate(s.start)}`;
		if (!s.end) return `since ${formatDate(s.start)} · ${formatSpan(s.days)}`;
		return `${formatDate(s.start)} – ${formatDate(shiftDays(s.end, -1))} · ${formatSpan(s.days)}`;
	}

	function changeText(s: Stretch): string {
		const to = STATUS_LABEL[s.rec.status];
		if (!s.prev) return `Started ${to.toLowerCase()}`;
		if (s.prev.status === s.rec.status) return `Still ${to.toLowerCase()}`;
		return `${STATUS_LABEL[s.prev.status]} → ${to}`;
	}

	// ── Writes ──
	function edit(rec: StatusRecord, next: StatusEdit) {
		open = null;
		if (isDomain) editDomainStatusRecord(index, entity as Domain, rec.date, next);
		else editProjectStatusRecord(index, entity, rec.date, next);
	}

	// A transition owns the date and the reason; the stretch's fields go back as
	// they are (intensity is left out, so it's kept).
	function saveTransition(rec: StatusRecord, d: RecordDraft) {
		edit(rec, { date: d.date, status: rec.status, note: rec.note ?? "", why: d.why });
	}

	// A stretch owns the status, intensity and intention; the reason is left
	// out, so it's kept. Intensity is only the editor's while active.
	function saveStretch(rec: StatusRecord, d: RecordDraft) {
		edit(rec, {
			date: rec.date,
			status: d.status,
			note: d.note,
			...(d.status === "active" ? { intensity: d.intensity } : {}),
		});
	}

	// Deleting a change joins the stretch before it to the one after.
	function deleteTransition(rec: StatusRecord) {
		open = null;
		if (isDomain) removeDomainStatusRecord(index, entity as Domain, rec.date);
		else removeProjectStatusRecord(index, entity, rec.date);
	}

	function addChange(d: RecordDraft) {
		adding = false;
		if (isDomain)
			setDomainStatus(index, entity as Domain, d.date, d.status, d.note, d.why, d.intensity);
		else setProjectStatus(index, entity, d.date, d.status, d.note, d.why, d.intensity);
	}

	function keys(e: KeyboardEvent, part: Part, s: Stretch) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			select(part, s.start);
		}
	}
</script>

<div class="setting-group">
	<div class="setting-item setting-item-heading">
		<div class="setting-item-info"><div class="setting-item-name">Status history</div></div>
		<div class="setting-item-control">
			<button
				disabled={adding || readonly}
				onclick={() => {
					open = null;
					adding = true;
				}}>Add change</button
			>
		</div>
	</div>
	<div class="setting-items kairos-tl">
		{#if parts.length > 0}
			<div class="kairos-tl-strip">
				<StatusStrip {parts} {open} {readonly} onSelect={select} />
			</div>
		{/if}

		{#if adding}
			<div class="kairos-tl-row kairos-tl-new">
				<span class="kairos-tl-rail"><span class="kairos-tl-node"></span></span>
				<div class="kairos-tl-editing">
					<StatusRecordEditor
						part="all"
						{states}
						onSave={addChange}
						onCancel={() => (adding = false)}
					/>
				</div>
			</div>
		{/if}

		{#if stretches.length === 0 && !adding}
			<p class="kairos-tl-empty">No changes recorded yet, so it counts as active.</p>
		{/if}

		{#each newestFirst as s (s.start)}
			<!-- The stretch: what it was, for how long. -->
			<div
				class="kairos-tl-row kairos-tl-stretch"
				class:is-future={s.future}
				data-status={s.rec.status}
			>
				<span class="kairos-tl-rail"></span>
				{#if isOpen("stretch", s)}
					<div class="kairos-tl-editing">
						<StatusRecordEditor
							part="stretch"
							initial={s.rec}
							{states}
							onSave={(d: RecordDraft) => saveStretch(s.rec, d)}
							onCancel={() => (open = null)}
						/>
					</div>
				{:else}
					<div
						class="kairos-tl-body"
						role="button"
						tabindex={readonly ? -1 : 0}
						aria-label="Edit this stretch"
						onclick={() => select("stretch", s.start)}
						onkeydown={(e) => keys(e, "stretch", s)}
					>
						<div class="kairos-tl-line">
							<span class="kairos-tl-status">{STATUS_LABEL[s.rec.status]}</span>
							{#if s.rec.status === "active" && s.rec.intensity !== undefined}
								<span
									class="kairos-tl-intensity"
									title={`Intensity ${s.rec.intensity} of ${INTENSITY_MAX}`}
								>
									<IntensityBars level={s.rec.intensity} />
								</span>
							{/if}
							{#if s.current}<Tag tone="accent">Now</Tag>
							{:else if s.future}<Tag>Scheduled</Tag>{/if}
							<span class="kairos-tl-spacer"></span>
							<span class="kairos-tl-meta">{spanText(s)}</span>
							{#if !readonly}<span class="kairos-tl-edit" use:icon={"pencil"}></span>{/if}
						</div>
						{#if s.rec.note}<div class="kairos-tl-note">{s.rec.note}</div>{/if}
					</div>
				{/if}
			</div>

			<!-- The transition into it: when, and why. -->
			<div class="kairos-tl-row kairos-tl-transition" data-status={s.rec.status}>
				<span class="kairos-tl-rail"><span class="kairos-tl-node"></span></span>
				{#if isOpen("transition", s)}
					<div class="kairos-tl-editing">
						<StatusRecordEditor
							part="transition"
							initial={s.rec}
							{states}
							onSave={(d: RecordDraft) => saveTransition(s.rec, d)}
							onDelete={() => deleteTransition(s.rec)}
							onCancel={() => (open = null)}
						/>
					</div>
				{:else}
					<div
						class="kairos-tl-body"
						role="button"
						tabindex={readonly ? -1 : 0}
						aria-label="Edit this change"
						onclick={() => select("transition", s.start)}
						onkeydown={(e) => keys(e, "transition", s)}
					>
						<div class="kairos-tl-line">
							<span class="kairos-tl-date">{formatDate(s.start)}</span>
							<span class="kairos-tl-change">{changeText(s)}</span>
							<span class="kairos-tl-spacer"></span>
							{#if !readonly}<span class="kairos-tl-edit" use:icon={"pencil"}></span>{/if}
						</div>
						<div class="kairos-tl-why" class:is-none={!s.rec.why}>
							{s.rec.why || "No reason recorded"}
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.kairos-tl {
		display: flex;
		flex-direction: column;
		padding: var(--size-4-4) var(--setting-items-padding-x, var(--size-4-4));
	}
	.kairos-tl-strip {
		margin-bottom: var(--size-4-4);
	}
	.kairos-tl-empty {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	/* Each row is the rail, then its text. */
	.kairos-tl-row {
		display: flex;
		align-items: stretch;
		gap: var(--size-4-3);
	}
	[data-status="active"] {
		--kairos-tl-color: var(--color-green);
	}
	[data-status="inactive"] {
		--kairos-tl-color: var(--text-faint);
	}
	[data-status="archived"] {
		--kairos-tl-color: var(--color-red);
	}
	.kairos-tl-rail {
		position: relative;
		flex: 0 0 var(--size-4-4);
		display: flex;
		justify-content: center;
	}
	/* A stretch is a solid bar in its status colour, dashed while scheduled. */
	.kairos-tl-stretch .kairos-tl-rail::before {
		content: "";
		width: var(--kairos-accent-width);
		border-radius: var(--kairos-radius-s);
		background: var(--kairos-tl-color);
	}
	.kairos-tl-stretch.is-future .kairos-tl-rail::before {
		background: none;
		border-left: var(--kairos-accent-width) dashed var(--kairos-tl-color);
	}
	/* A transition is a thin line with a diamond on it, in the colour it
	   changed to. */
	.kairos-tl-transition .kairos-tl-rail::before,
	.kairos-tl-new .kairos-tl-rail::before {
		content: "";
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: var(--border-width) solid var(--background-modifier-border);
	}
	.kairos-tl-node {
		position: relative;
		margin-top: var(--size-4-2);
		width: var(--size-4-2);
		height: var(--size-4-2);
		transform: rotate(45deg);
		background: var(--kairos-tl-color, var(--interactive-accent));
	}

	.kairos-tl-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--size-2-1);
		padding: var(--size-4-1) var(--size-4-2);
		border-radius: var(--radius-s);
		cursor: pointer;
	}
	.kairos-tl-stretch .kairos-tl-body {
		padding-block: var(--size-4-3);
	}
	.kairos-tl-body:hover {
		background: var(--background-modifier-hover);
	}
	.kairos-tl-body[tabindex="-1"] {
		cursor: default;
	}
	.kairos-tl-body[tabindex="-1"]:hover {
		background: none;
	}
	.kairos-tl-editing {
		flex: 1;
		min-width: 0;
		padding-block: var(--size-4-2);
	}
	.kairos-tl-line {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		min-width: 0;
	}
	.kairos-tl-spacer {
		flex: 1;
	}
	.kairos-tl-status {
		color: var(--text-normal);
	}
	.kairos-tl-intensity {
		display: inline-flex;
		color: var(--text-muted);
	}
	.kairos-tl-meta,
	.kairos-tl-date {
		color: var(--text-muted);
		font-size: var(--font-ui-small);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.kairos-tl-change {
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}
	.kairos-tl-note {
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}
	.kairos-tl-why {
		color: var(--text-normal);
		font-size: var(--font-ui-small);
		font-style: italic;
	}
	.kairos-tl-why.is-none {
		color: var(--text-faint);
		font-style: normal;
	}
	/* The pencil shows on hover or focus: the part opens for editing. */
	.kairos-tl-edit {
		--icon-size: var(--icon-xs);
		display: flex;
		opacity: 0;
		color: var(--text-faint);
	}
	.kairos-tl-body:is(:hover, :focus-visible) .kairos-tl-edit {
		opacity: 1;
	}
</style>
