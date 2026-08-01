<script lang="ts">
	import type { App } from "obsidian";
	import { onMount } from "svelte";
	import type { KairosSettings } from "../../settings";
	import type { Association, Block, ISODate, Task } from "../../types";
	import type { TimeRange } from "../../types";
	import { moveBlockAcrossDays } from "../../writer";
	import type { KairosIndex, Resolver } from "../../index";
	import {
		dateFromISO,
		ensureNoteForDate,
		isoFromDate,
		notePathForDate,
		shiftISO,
		todayISO,
	} from "../../dayNote";
	import DayColumn from "./DayColumn.svelte";
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import Datepicker from "../components/Datepicker.svelte";
	import {
		geometryFromSettings,
		gridHeight,
		minutesToOffset,
		visibleHours,
	} from "./layout";

	interface Props {
		app: App;
		index: KairosIndex;
		settings: KairosSettings;
		saveSettings: () => void;
	}

	let { app, index, settings, saveSettings }: Props = $props();

	// Live association resolver (re-tints on project/domain file changes).
	let resolve = $state<Resolver>(() => ({ displayName: "", resolved: false }));

	// Shared vertical geometry — one time axis for the whole week.
	const geo = $derived(geometryFromSettings(settings));
	const hours = $derived(visibleHours(geo));
	const bodyHeight = $derived(gridHeight(geo));

	// ── The week window ──
	// Default window is [today − before, today + after] from settings. It's still
	// navigable: `anchor` is the window's first day; arrows shift it, "Today"
	// snaps back to the settings-defined window around today.

	function clampSpan(n: number): number {
		return Math.max(1, Math.min(7, Math.floor(n)));
	}

	const before = $derived(clampSpan(settings.weekDaysBefore));
	const after = $derived(clampSpan(settings.weekDaysAfter));
	const windowSize = $derived(before + after + 1); // inclusive of today

	// The window's first day. Initialized to the today-relative default; arrows
	// move it freely from there.
	let anchor = $state<ISODate>(shiftISO(todayISO(), -clampSpan(1)));

	// Recompute the default anchor whenever the span settings change, but only
	// while we're still showing the default window (so a user who navigated away
	// isn't yanked back by a settings tweak).
	let atDefault = $state(true);
	$effect(() => {
		if (atDefault) anchor = shiftISO(todayISO(), -before);
	});

	const dates = $derived(
		Array.from({ length: windowSize }, (_, i) => shiftISO(anchor, i)),
	);

	function stepWindow(deltaDays: number) {
		atDefault = false;
		anchor = shiftISO(anchor, deltaDays);
		closeAssocPicker();
	}

	function goToday() {
		atDefault = true;
		anchor = shiftISO(todayISO(), -before);
		closeAssocPicker();
	}

	function jumpTo(date: ISODate) {
		atDefault = false;
		// Center the jumped date within the window as best we can.
		anchor = shiftISO(date, -before);
		showCalendar = false;
		closeAssocPicker();
	}

	const rangeLabel = $derived.by(() => {
		const first = dateFromISO(dates[0]!).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
		const last = dateFromISO(dates[dates.length - 1]!).toLocaleDateString(
			undefined,
			{ month: "short", day: "numeric" },
		);
		return `${first} – ${last}`;
	});

	function columnLabel(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			weekday: "short",
			day: "numeric",
		});
	}
	function isToday(date: ISODate): boolean {
		return date === todayISO();
	}

	// ── Calendar + hour controls (mirrors DayView's header popovers) ──
	let showCalendar = $state(false);
	let calendarValue = $state<Date>(dateFromISO(todayISO()));
	let dateNavRef = $state<HTMLDivElement>();

	let showControls = $state(false);
	let controlsRef = $state<HTMLDivElement>();

	function setStartHour(value: number) {
		const v = Math.max(0, Math.min(23, Math.floor(value)));
		settings.timelineStartHour = v;
		if (settings.timelineEndHour <= v) settings.timelineEndHour = v + 1;
		saveSettings();
	}
	function setEndHour(value: number) {
		const v = Math.max(1, Math.min(24, Math.floor(value)));
		settings.timelineEndHour = v;
		if (settings.timelineStartHour >= v) settings.timelineStartHour = v - 1;
		saveSettings();
	}
	function setHourHeight(value: number) {
		settings.timelineHourHeight = Math.max(20, Math.min(240, Math.floor(value)));
		saveSettings();
	}

	function handleClickOutside(event: MouseEvent) {
		if (showControls && controlsRef && !controlsRef.contains(event.target as Node)) {
			showControls = false;
		}
		if (showCalendar && dateNavRef && !dateNavRef.contains(event.target as Node)) {
			showCalendar = false;
		}
	}

	// ── Column registry (for pointer forwarding + cross-day commits) ──
	// Svelte 5: `bind:this` on each DayColumn gives us its exported methods.
	let columns = $state<Record<string, DayColumn>>({});
	let columnEls = $state<Record<string, HTMLDivElement>>({});

	// The column a live gesture began on, and the block it grabbed (single-block
	// move only). Non-null only during a potential cross-day drag.
	let dragFromDate = $state<ISODate | null>(null);
	let dragBlock = $state<Block | null>(null);
	// The date the pointer is currently hovering (drop target highlight).
	let hoverDate = $state<ISODate | null>(null);

	// The column that most recently had a gesture/selection, so keyboard delete
	// targets the right day.
	let focusedDate = $state<ISODate | null>(null);

	// A column reports a single-block move began: remember it as a cross-day
	// candidate and start highlighting drop targets.
	function onCrossDayGrab(date: ISODate, block: Block, _event: PointerEvent) {
		dragFromDate = date;
		dragBlock = block;
		hoverDate = date;
		focusedDate = date;
	}

	// Which column's canvas is under this X? Returns its date or null.
	function columnAt(clientX: number, clientY: number): ISODate | null {
		for (const date of dates) {
			const el = columnEls[date];
			if (!el) continue;
			const r = el.getBoundingClientRect();
			if (
				clientX >= r.left &&
				clientX <= r.right &&
				clientY >= r.top &&
				clientY <= r.bottom
			) {
				return date;
			}
		}
		return null;
	}

	function onWindowPointerMove(event: PointerEvent) {
		// Forward to every column; the one owning the live gesture consumes it.
		let handled = false;
		for (const date of dates) {
			if (columns[date]?.handlePointerMove(event)) handled = true;
		}
		if (handled && dragBlock) {
			hoverDate = columnAt(event.clientX, event.clientY);
		}
	}

	async function onWindowPointerUp(event: PointerEvent) {
		// Snapshot cross-day intent before columns clear their gesture state.
		const from = dragFromDate;
		const grabbed = dragBlock;
		const dropDate =
			from && grabbed ? columnAt(event.clientX, event.clientY) : null;

		// Let every column resolve its own pointer-up. The source column returns
		// the grabbed block + its previewed (vertical) range.
		let returned: { date: ISODate; block: Block; time: TimeRange } | null =
			null;
		for (const date of dates) {
			const res = columns[date]?.handlePointerUp();
			if (res) returned = { date, ...res };
		}

		dragFromDate = null;
		dragBlock = null;
		hoverDate = null;

		if (!returned) return;

		// A cross-day drop: the block left `returned.date` and lands on `dropDate`.
		if (
			from &&
			dropDate &&
			dropDate !== returned.date &&
			returned.block.source.line === grabbed?.source.line
		) {
			await commitCrossDay(returned.date, dropDate, returned.block, returned.time);
			return;
		}

		// Stayed in-column: commit the deferred vertical retime.
		columns[returned.date]?.commitLocalMove(returned.block, returned.time);
	}

	// CORE-LOGIC boundary call: assemble both days' arrays via the writer's pure
	// primitive, then commit them atomically through the index. The moved block
	// keeps its previewed time (its vertical position on the destination day).
	async function commitCrossDay(
		fromDate: ISODate,
		toDate: ISODate,
		block: Block,
		time: TimeRange,
	) {
		const fromCol = columns[fromDate];
		const toCol = columns[toDate];
		if (!fromCol || !toCol) return;

		const fromPath = fromCol.currentPath() ?? (await fromCol.ensurePath());
		const toPath = toCol.currentPath() ?? (await toCol.ensurePath());

		const { from, to } = moveBlockAcrossDays(
			fromCol.currentBlocks(),
			toCol.currentBlocks(),
			block,
			toPath,
			time,
		);

		// Reflect the removal locally on the source column so its mirror matches
		// what we're about to persist (the index write is authoritative).
		fromCol.removeBlockLocally(block);

		index.applyCrossDayMove(fromDate, fromPath, from, toDate, toPath, to);
	}

	// ── Association picker (shared, week-level) ──
	type PickerTarget =
		| { kind: "block"; date: ISODate; block: Block }
		| { kind: "task"; date: ISODate; block: Block; task: Task };

	let pickerTarget = $state<PickerTarget | null>(null);
	let pickerAnchor = $state<DOMRect | null>(null);

	const pickerCurrent = $derived.by(() => {
		if (!pickerTarget) return undefined;
		return pickerTarget.kind === "block"
			? pickerTarget.block.assoc
			: pickerTarget.task.assoc;
	});

	function openBlockAssoc(date: ISODate, block: Block, anchor: DOMRect) {
		pickerTarget = { kind: "block", date, block };
		pickerAnchor = anchor;
	}
	function openTaskAssoc(date: ISODate, block: Block, task: Task, anchor: DOMRect) {
		pickerTarget = { kind: "task", date, block, task };
		pickerAnchor = anchor;
	}
	function closeAssocPicker() {
		pickerTarget = null;
		pickerAnchor = null;
	}
	function onPickAssoc(assoc: Association | null) {
		if (pickerTarget?.kind === "block") {
			columns[pickerTarget.date]?.applyBlockAssoc(pickerTarget.block, assoc);
		} else if (pickerTarget?.kind === "task") {
			columns[pickerTarget.date]?.applyTaskAssoc(
				pickerTarget.block,
				pickerTarget.task,
				assoc,
			);
		}
		closeAssocPicker();
	}

	// ── Keyboard: delete the focused column's selection ──
	function isEditableTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName;
		return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
	}
	function onKeyDown(event: KeyboardEvent) {
		if (isEditableTarget(event.target)) return;
		const key = event.key.toLowerCase();
		if (key === "x" || key === "delete" || key === "backspace") {
			const date = focusedDate;
			if (!date || !columns[date]?.hasSelection()) return;
			event.preventDefault();
			columns[date].deleteSelection();
		} else if (key === "escape") {
			for (const date of dates) columns[date]?.clearSelection();
		}
	}

	// Track which column was last pressed, for keyboard delete targeting.
	function markFocused(date: ISODate) {
		focusedDate = date;
	}

	function onCalendarSelect(picked: Date) {
		jumpTo(isoFromDate(picked));
	}

	onMount(() => {
		const unsubscribeResolver = index.resolver().subscribe((r) => {
			resolve = r;
		});
		const move = (e: PointerEvent) => onWindowPointerMove(e);
		const up = (e: PointerEvent) => void onWindowPointerUp(e);
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		return () => {
			unsubscribeResolver();
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
	});

	void notePathForDate;
	void ensureNoteForDate;
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="week-view" tabindex="-1" onclick={handleClickOutside} onkeydown={onKeyDown}>
	<div class="week-header">
		<div class="day-nav" bind:this={dateNavRef}>
			<button
				class="icon-btn nav-btn"
				onclick={(e) => {
					e.stopPropagation();
					stepWindow(-windowSize);
				}}
				aria-label="Previous window"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
			</button>

			<button
				class="day-date"
				title="Click to pick a date"
				onclick={(e) => {
					e.stopPropagation();
					showCalendar = !showCalendar;
				}}
			>
				{rangeLabel}
			</button>

			<button
				class="icon-btn nav-btn"
				onclick={(e) => {
					e.stopPropagation();
					stepWindow(windowSize);
				}}
				aria-label="Next window"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
			</button>

			{#if !atDefault}
				<button class="today-btn" onclick={(e) => { e.stopPropagation(); goToday(); }}>
					Today
				</button>
			{/if}

			{#if showCalendar}
				<div class="calendar-popup">
					<Datepicker inline bind:value={calendarValue} onselect={onCalendarSelect} />
				</div>
			{/if}
		</div>

		<span class="week-header-spacer"></span>
		<span class="day-range-label">
			{String(geo.startHour).padStart(2, "0")}:00–{String(geo.endHour).padStart(2, "0")}:00
		</span>
		<div class="controls-wrap" bind:this={controlsRef}>
			<button
				class="icon-btn"
				onclick={(e) => { e.stopPropagation(); showControls = !showControls; }}
				aria-label="Timeline hours"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
			</button>

			{#if showControls}
				<div class="controls-popup">
					<label class="controls-field">
						<span class="controls-label">Start hour</span>
						<input type="number" class="controls-input" min="0" max="23" value={geo.startHour} oninput={(e) => setStartHour(+e.currentTarget.value)} />
					</label>
					<label class="controls-field">
						<span class="controls-label">End hour</span>
						<input type="number" class="controls-input" min="1" max="24" value={geo.endHour} oninput={(e) => setEndHour(+e.currentTarget.value)} />
					</label>
					<label class="controls-field">
						<span class="controls-label">Hour height</span>
						<input type="number" class="controls-input" min="20" max="240" step="5" value={geo.hourHeight} oninput={(e) => setHourHeight(+e.currentTarget.value)} />
					</label>
				</div>
			{/if}
		</div>
	</div>

	<!-- Column titles row, aligned with the columns below (offset by the gutter). -->
	<div class="week-colheads">
		<div class="week-gutter-spacer"></div>
		{#each dates as date (date)}
			<button
				class="col-head"
				class:today={isToday(date)}
				title="Ctrl+click to open the daily note"
				onclick={(e) => {
					e.stopPropagation();
					if (e.ctrlKey || e.metaKey) columns[date]?.openNote();
				}}
			>
				{columnLabel(date)}
			</button>
		{/each}
	</div>

	<div class="week-scroll">
		<div class="week-body">
			<!-- Shared hour gutter + grid lines span the full column strip. -->
			<div class="week-gutter" style={`height: ${bodyHeight}px;`}>
				{#each hours as hour (hour)}
					<div class="day-hour-label" style={`top: ${minutesToOffset(hour * 60, geo)}px;`}>
						{String(hour).padStart(2, "0")}:00
					</div>
				{/each}
			</div>

			<div class="week-columns">
				<!-- Grid lines drawn once across all columns, behind them. -->
				<div class="week-lines" style={`height: ${bodyHeight}px;`}>
					{#each hours as hour (hour)}
						<div class="day-hour-line" style={`top: ${minutesToOffset(hour * 60, geo)}px;`}></div>
					{/each}
				</div>

				{#each dates as date (date)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="week-col"
						class:drop-target={hoverDate === date && dragFromDate !== null && dragFromDate !== date}
						class:drag-source={dragFromDate === date}
						bind:this={columnEls[date]}
						onpointerdown={() => markFocused(date)}
					>
						<DayColumn
							bind:this={columns[date]}
							{app}
							{index}
							{date}
							{geo}
							{resolve}
							onEditAssoc={openBlockAssoc}
							onEditTaskAssoc={openTaskAssoc}
							{onCrossDayGrab}
						/>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

{#if pickerTarget && pickerAnchor}
	<AssociationPicker
		options={index.associationOptions()}
		current={pickerCurrent}
		anchor={pickerAnchor}
		onPick={onPickAssoc}
		onClose={closeAssocPicker}
	/>
{/if}

<style>
	.week-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.week-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px 6px;
		flex-shrink: 0;
	}

	.day-nav {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.nav-btn {
		height: 24px;
		width: 24px;
	}

	.day-date {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-normal);
		font-variant-numeric: tabular-nums;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 3px 8px;
		cursor: pointer;
		white-space: nowrap;
	}

	.day-date:hover {
		background: var(--background-modifier-hover);
	}

	.today-btn {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--background-primary-alt);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 3px 8px;
		cursor: pointer;
	}

	.today-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.calendar-popup {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 100;
	}

	.week-header-spacer {
		flex: 1;
	}

	.day-range-label {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.controls-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.icon-btn {
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary-alt);
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 26px;
		width: 26px;
		flex-shrink: 0;
	}

	.icon-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.icon-btn svg {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	.controls-popup {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		padding: 12px;
		box-shadow: var(--shadow-s);
		z-index: 100;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 170px;
	}

	.controls-field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.controls-label {
		font-size: 12px;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.controls-input {
		width: 56px;
		padding: 3px 6px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary-alt);
		color: var(--text-normal);
		font-size: 12px;
		text-align: center;
	}

	/* ── Column heads ── */
	.week-colheads {
		display: flex;
		flex-shrink: 0;
		padding: 0 10px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.week-gutter-spacer {
		width: 46px;
		min-width: 46px;
	}

	.col-head {
		flex: 1;
		min-width: 0;
		text-align: center;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		background: transparent;
		border: none;
		padding: 6px 4px;
		cursor: pointer;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.col-head:hover {
		color: var(--text-normal);
	}

	.col-head.today {
		color: var(--interactive-accent);
	}

	/* ── Body ── */
	.week-scroll {
		flex: 1;
		overflow: auto;
	}

	.week-body {
		display: flex;
		padding: 0 10px;
		min-width: 0;
	}

	.week-gutter {
		width: 46px;
		min-width: 46px;
		position: relative;
		border-right: 1px solid var(--background-modifier-border);
	}

	.day-hour-label {
		position: absolute;
		right: 6px;
		transform: translateY(-0.5em);
		font-size: 10px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.week-columns {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
	}

	.week-lines {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		pointer-events: none;
		z-index: 0;
	}

	.day-hour-line {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--background-modifier-border);
		opacity: 0.5;
	}

	.week-col {
		flex: 1;
		min-width: 0;
		position: relative;
		border-left: 1px solid var(--background-modifier-border);
	}

	.week-col:first-child {
		border-left: none;
	}

	/* Cross-day drag affordances. */
	.week-col.drop-target {
		background: var(--interactive-accent);
		box-shadow: inset 0 0 0 2px var(--interactive-accent);
	}
	.week-col.drop-target :global(.col-canvas) {
		background: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
	}
	.week-col.drag-source {
		background: var(--background-modifier-hover);
	}
</style>
