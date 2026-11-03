<script lang="ts">
	// A project's or domain's status history in the detail pane (ProjectDetail):
	// the strip to scale on top (StatusStrip), then the same history as a
	// timeline, newest first. The timeline alternates the two parts of every
	// record (statusStretches.ts). A stretch, on the rail in the entity's colour
	// (dashed where nothing is active), holds the status, intensity and
	// intention; a change, a diamond on the rail, holds the date and the
	// reason. The reason sits on the change it explains, not on the state.
	//
	// Everything is edited where it's shown, with no form: the status opens a
	// menu, the intensity bars pick a level, the date opens the calendar, and
	// the intention and reason are text you click and type over (ItemText).
	// **Add change** picks a status from today and starts on its reason.
	//
	// Every write goes through projectActions, whose pure edit functions own
	// the history's invariants. An edit passes only the keys it changes (with
	// the status and date it needs), so `why` and intensity stay as stored.

	import { Menu } from "obsidian";
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
	import { effectiveStatus } from "../../projectFile";
	import { dateFromISO, isoFromDate, todayISO } from "../../dayNote";
	import { shiftDays } from "../../gantt/ganttUtils";
	import Datepicker from "../components/Datepicker.svelte";
	import IconButton from "../components/IconButton.svelte";
	import IntensityBars from "../components/IntensityBars.svelte";
	import ItemText from "../components/ItemText.svelte";
	import Portal from "../components/Portal.svelte";
	import Tag from "../components/Tag.svelte";
	import { icon } from "../actions/icon";
	import StatusStrip from "./StatusStrip.svelte";
	import { formatSpan, stretchesOf, type Stretch } from "./statusStretches";

	interface Props {
		index: KairosIndex;
		entity: Project | Domain;
		isDomain: boolean;
		readonly: boolean;
		/** The project's or domain's colour, for its bars. */
		color: string;
		/** The text being typed over: a stretch's intention or a change's reason.
		 *  Bindable, so the pane can start on a change's reason after a status change. */
		typing?: { part: "stretch" | "transition"; date: ISODate } | null;
	}

	let { index, entity, isDomain, readonly, color, typing = $bindable(null) }: Props = $props();

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

	type Part = "stretch" | "transition";

	function isTyping(part: Part, date: ISODate): boolean {
		return typing?.part === part && typing.date === date;
	}
	function setTyping(part: Part, date: ISODate, on: boolean) {
		if (on) typing = { part, date };
		else if (isTyping(part, date)) typing = null;
	}

	/** Start typing a change's reason, as after adding one. */
	function editWhy(date: ISODate) {
		if (!readonly) typing = { part: "transition", date };
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
	function edit(rec: StatusRecord, next: Partial<StatusEdit>) {
		const full: StatusEdit = { date: rec.date, status: rec.status, note: rec.note ?? "", ...next };
		if (isDomain) editDomainStatusRecord(index, entity as Domain, rec.date, full);
		else editProjectStatusRecord(index, entity, rec.date, full);
	}

	function setIntensity(rec: StatusRecord, level: number | undefined) {
		edit(rec, { intensity: level });
	}

	// Deleting a change joins the stretch before it to the one after.
	function remove(rec: StatusRecord) {
		if (isDomain) removeDomainStatusRecord(index, entity as Domain, rec.date);
		else removeProjectStatusRecord(index, entity, rec.date);
	}

	function statusMenu(rec: StatusRecord, e: MouseEvent) {
		if (readonly) return;
		const menu = new Menu();
		for (const s of states) {
			menu.addItem((item) =>
				item
					.setTitle(STATUS_LABEL[s])
					.setChecked(rec.status === s)
					.onClick(() => {
						if (s !== rec.status) edit(rec, { status: s });
					}),
			);
		}
		menu.showAtMouseEvent(e);
	}

	// Add change: a status from today, then its reason. The one in effect is
	// left out, since a change to it today would be no change.
	function addMenu(e: MouseEvent) {
		const now = effectiveStatus(entity.history, today);
		const menu = new Menu();
		for (const s of states) {
			if (s === now) continue;
			menu.addItem((item) =>
				item.setTitle(`${STATUS_LABEL[s]} from today`).onClick(() => {
					if (isDomain) setDomainStatus(index, entity as Domain, today, s);
					else setProjectStatus(index, entity, today, s);
					editWhy(today);
				}),
			);
		}
		menu.showAtMouseEvent(e);
	}

	// ── The calendar for a change's date ──
	let picking = $state<{ rec: StatusRecord; top: number; left: number } | null>(null);
	let pickValue = $state<Date>(new Date());

	function openPicker(rec: StatusRecord, el: HTMLElement) {
		if (readonly) return;
		const r = el.getBoundingClientRect();
		pickValue = dateFromISO(rec.date);
		picking = { rec, top: r.bottom + 4, left: r.left };
	}
	function pickDate(d: Date) {
		const p = picking;
		picking = null;
		const date = isoFromDate(d);
		if (p && date !== p.rec.date) edit(p.rec, { date });
	}

	// Select a part from the strip: start typing its text.
	function selectFromStrip(part: Part, date: ISODate) {
		if (!readonly) typing = { part, date };
	}

	function keys(e: KeyboardEvent, act: () => void) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			act();
		}
	}
</script>

<div class="setting-group">
	<div class="setting-item setting-item-heading">
		<div class="setting-item-info"><div class="setting-item-name">Status history</div></div>
		<!-- A frameless Kairos button that keeps to its label: a plain button
		     in a settings row stretched to the pane's full width on a phone. -->
		<div class="setting-item-control sh-add">
			<IconButton label="Add change" disabled={readonly} onclick={addMenu}>
				<span class="sh-add-icon" use:icon={"plus"}></span>
				<span class="sh-add-label">Add change</span>
			</IconButton>
		</div>
	</div>
	<div class="setting-items kairos-tl" class:is-readonly={readonly}>
		{#if stretches.length > 0}
			<div class="kairos-tl-strip">
				<StatusStrip
					history={entity.history}
					{today}
					{color}
					{readonly}
					marked={typing}
					onSelect={selectFromStrip}
					onMoveChange={(from: ISODate, to: ISODate) => {
						const rec = entity.history.find((r) => r.date === from);
						if (rec) edit(rec, { date: to });
					}}
					onPickIntensity={(date: ISODate, level: number | undefined) => {
						const rec = entity.history.find((r) => r.date === date);
						if (rec) setIntensity(rec, level);
					}}
				/>
			</div>
		{:else}
			<p class="kairos-tl-empty">No changes recorded yet, so it counts as active.</p>
		{/if}

		{#each newestFirst as s (s.start)}
			<!-- The stretch: what it was, how hard, what for, and for how long. -->
			<div
				class="kairos-tl-row kairos-tl-stretch"
				class:is-active={s.rec.status === "active"}
				class:is-future={s.future}
				style:--kairos-tl-color={color}
			>
				<span class="kairos-tl-rail"></span>
				<div class="kairos-tl-body">
					<div class="kairos-tl-line">
						<span
							class="kairos-tl-pick kairos-tl-status"
							role="button"
							tabindex={readonly ? -1 : 0}
							aria-label="Change this stretch's status"
							onclick={(e) => statusMenu(s.rec, e)}
							onkeydown={(e) => keys(e, () => (e.currentTarget).click())}
							>{STATUS_LABEL[s.rec.status]}<span
								class="kairos-tl-pick-icon"
								use:icon={"chevron-down"}
							></span></span
						>
						{#if s.rec.status === "active"}
							<span class="kairos-tl-intensity" class:unrated={s.rec.intensity === undefined}>
								<IntensityBars
									level={s.rec.intensity}
									onpick={readonly ? undefined : (level: number | undefined) => setIntensity(s.rec, level)}
								/>
							</span>
						{/if}
						{#if s.current}<Tag tone="accent">Now</Tag>
						{:else if s.future}<Tag>Scheduled</Tag>{/if}
						<span class="kairos-tl-spacer"></span>
						<span class="kairos-tl-meta">{spanText(s)}</span>
					</div>
					<ItemText
						text={s.rec.note ?? ""}
						lines={3}
						placeholder="No intention"
						bind:editing={() => isTyping("stretch", s.start), (on: boolean) => setTyping("stretch", s.start, on)}
						onCommit={readonly ? undefined : (text: string) => edit(s.rec, { note: text.trim() })}
					/>
				</div>
			</div>

			<!-- The change into it: when, from what, and why. -->
			<div class="kairos-tl-row kairos-tl-transition" data-status={s.rec.status}>
				<span class="kairos-tl-rail"><span class="kairos-tl-node"></span></span>
				<div class="kairos-tl-body">
					<div class="kairos-tl-line">
						<span
							class="kairos-tl-pick kairos-tl-date"
							role="button"
							tabindex={readonly ? -1 : 0}
							aria-label="Change the date"
							onclick={(e) => openPicker(s.rec, e.currentTarget)}
							onkeydown={(e) => keys(e, () => openPicker(s.rec, e.currentTarget))}
							><span class="kairos-tl-pick-icon" use:icon={"calendar"}></span>{formatDate(
								s.start,
							)}</span
						>
						<span class="kairos-tl-change">{changeText(s)}</span>
						<span class="kairos-tl-spacer"></span>
						{#if !readonly}
							<span class="kairos-tl-delete">
								<IconButton label="Delete this change" icon="trash-2" onclick={() => remove(s.rec)} />
							</span>
						{/if}
					</div>
					<span class="kairos-tl-why">
						<ItemText
							text={s.rec.why ?? ""}
							lines={3}
							placeholder="No reason recorded"
							bind:editing={() => isTyping("transition", s.start), (on: boolean) => setTyping("transition", s.start, on)}
							onCommit={readonly ? undefined : (text: string) => edit(s.rec, { why: text.trim() })}
						/>
					</span>
				</div>
			</div>
		{/each}
	</div>
</div>

{#if picking}
	<Portal>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="kairos-date-scrim" onclick={() => (picking = null)}>
			<div
				class="kairos-date-anchor"
				style:top={`${picking.top}px`}
				style:left={`${picking.left}px`}
				onclick={(e) => e.stopPropagation()}
			>
				<Datepicker inline bind:value={pickValue} onselect={pickDate} />
			</div>
		</div>
	</Portal>
{/if}

<style>
	.sh-add {
		flex: none;
		width: auto;
	}
	.sh-add-icon {
		display: inline-flex;
	}
	.sh-add-label {
		margin-inline-start: var(--size-2-2);
	}
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
		font-size: var(--kairos-text-body);
	}

	/* Each row is the rail, then its text. */
	.kairos-tl-row {
		display: flex;
		align-items: stretch;
		gap: var(--size-4-3);
	}
	.kairos-tl-rail {
		position: relative;
		flex: 0 0 var(--size-4-4);
		display: flex;
		justify-content: center;
	}
	/* A stretch on the rail: a bar in the entity's colour while active, as on
	   the Timeline, and a dashed line where nothing is. */
	.kairos-tl-stretch .kairos-tl-rail::before {
		content: "";
		border-left: var(--border-width) dashed var(--background-modifier-border);
	}
	.kairos-tl-stretch.is-active .kairos-tl-rail::before {
		width: var(--kairos-accent-width);
		border: none;
		border-radius: var(--kairos-radius-s);
		background: var(--kairos-tl-color);
	}
	.kairos-tl-stretch.is-active.is-future .kairos-tl-rail::before {
		opacity: 0.6;
	}
	/* A change: a diamond on a thin line, in the colour it changed to. */
	[data-status="active"] {
		--kairos-tl-node: var(--color-green);
	}
	[data-status="inactive"] {
		--kairos-tl-node: var(--text-faint);
	}
	[data-status="archived"] {
		--kairos-tl-node: var(--color-red);
	}
	.kairos-tl-transition .kairos-tl-rail::before {
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
		background: var(--kairos-tl-node);
	}

	.kairos-tl-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--size-2-1);
		padding-block: var(--size-4-1);
	}
	.kairos-tl-stretch .kairos-tl-body {
		padding-block: var(--size-4-3);
	}
	.kairos-tl-line {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		min-width: 0;
		min-height: var(--size-4-6);
	}
	.kairos-tl-spacer {
		flex: 1;
	}

	/* A word you click to change (the status, a change's date): plain text with
	   a hover fill, like the Timeline's labels. */
	.kairos-tl-pick {
		display: inline-flex;
		align-items: center;
		gap: var(--size-2-2);
		padding: 0 var(--size-2-2);
		margin-inline: calc(-1 * var(--size-2-2));
		border-radius: var(--radius-s);
		cursor: pointer;
	}
	.kairos-tl-pick:hover {
		background: var(--background-modifier-hover);
	}
	/* The icon says it's a control: a calendar on a date, a chevron on a status. */
	.kairos-tl-pick-icon {
		--icon-size: var(--icon-xs);
		display: flex;
		color: var(--text-faint);
	}
	.kairos-tl-pick:hover .kairos-tl-pick-icon {
		color: var(--text-muted);
	}
	.kairos-tl.is-readonly .kairos-tl-pick-icon {
		display: none;
	}
	.kairos-tl.is-readonly .kairos-tl-pick {
		cursor: default;
		pointer-events: none;
	}
	.kairos-tl-status {
		color: var(--text-normal);
		font-size: var(--kairos-text-name);
	}
	.kairos-tl-date {
		color: var(--text-normal);
		font-size: var(--kairos-text-body);
		font-variant-numeric: tabular-nums;
	}
	.kairos-tl-intensity {
		display: inline-flex;
		color: var(--kairos-tl-color);
	}
	/* Unrated: the bars show faintly, as the way to rate it. */
	.kairos-tl-intensity.unrated {
		opacity: 0.35;
	}
	.kairos-tl-meta,
	.kairos-tl-change {
		color: var(--text-muted);
		font-size: var(--kairos-text-label);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.kairos-tl-why {
		display: flex;
		min-width: 0;
		font-style: italic;
	}
	/* Delete shows when you point at the change. */
	.kairos-tl-delete {
		display: flex;
		opacity: 0;
	}
	.kairos-tl-transition:is(:hover, :focus-within) .kairos-tl-delete {
		opacity: 1;
	}
</style>
