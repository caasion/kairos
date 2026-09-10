<script lang="ts">
	import type { App } from "obsidian";
	import { onMount } from "svelte";
	import type { Readable } from "svelte/store";
	import type { KairosSettings } from "../../settings";
	import type {
		Association,
		BacklogEntry,
		Block,
		ISODate,
		Task,
	} from "../../types";
	import type { TimeRange } from "../../types";
	import { moveBlockAcrossDays } from "../../writer";
	import { blockOptions, type BlockOption } from "../../blockOptions";
	import { navigateToAssociation } from "../../navigate";
	import type { KairosIndex, Resolver } from "../../index";
	import {
		dateFromISO,
		ensureNoteForDate,
		isoFromDate,
		notePathForDate,
		shiftISO,
		todayISO,
	} from "../../dayNote";
	import { surfacedOn } from "../../backlogModel";
	import {
		insertEntry,
		resurfaceTomorrow,
		setResurface,
	} from "../../backlogActions";
	import BacklogNudge from "../backlog/BacklogNudge.svelte";
	import { placeUnderAnchor } from "../floating";
	import DayColumn from "./DayColumn.svelte";
	import { type UnscheduledItem } from "./taskDrag";
	import TaskRow from "../task/Task.svelte";
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import BlockPicker from "./BlockPicker.svelte";
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
		// Reactive settings store: the plugin republishes it on every write, so a
		// change from here, the Day view, or the settings tab reaches us live.
		settings$: Readable<KairosSettings>;
		// The one write path back to the plugin; it persists and republishes.
		updateSettings: (mutate: (s: KairosSettings) => void) => void;
	}

	let { app, index, settings$, updateSettings }: Props = $props();

	// Local reactive view of the settings. `$store` auto-subscribes, so every
	// derived below recomputes the instant the plugin republishes.
	const settings = $derived($settings$);

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
		closeBlockPicker();
	}

	function goToday() {
		atDefault = true;
		anchor = shiftISO(todayISO(), -before);
		closeAssocPicker();
		closeBlockPicker();
	}

	function jumpTo(date: ISODate) {
		atDefault = false;
		// Center the jumped date within the window as best we can.
		anchor = shiftISO(date, -before);
		showCalendar = false;
		closeAssocPicker();
		closeBlockPicker();
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

	// A date card's two lines: an uppercase day-of-week label over the day number
	// (Holos-style header), stacked in the column head markup.
	function dowLabel(date: ISODate): string {
		return dateFromISO(date)
			.toLocaleDateString(undefined, { weekday: "short" })
			.toUpperCase();
	}
	function dayNumber(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, { day: "numeric" });
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
		updateSettings((s) => {
			s.timelineStartHour = v;
			if (s.timelineEndHour <= v) s.timelineEndHour = v + 1;
		});
	}
	function setEndHour(value: number) {
		const v = Math.max(1, Math.min(24, Math.floor(value)));
		updateSettings((s) => {
			s.timelineEndHour = v;
			if (s.timelineStartHour >= v) s.timelineStartHour = v - 1;
		});
	}
	function setHourHeight(value: number) {
		updateSettings((s) => {
			s.timelineHourHeight = Math.max(20, Math.min(240, Math.floor(value)));
		});
	}
	function setDaysBefore(value: number) {
		updateSettings((s) => {
			s.weekDaysBefore = clampSpan(value);
		});
	}
	function setDaysAfter(value: number) {
		updateSettings((s) => {
			s.weekDaysAfter = clampSpan(value);
		});
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

	// Per-date unscheduled items pushed up from each DayColumn via callback.
	let unscheduledByDate = $state<Record<string, UnscheduledItem[]>>({});
	let unscheduledOpen = $state(true);

	function onUnscheduledChange(date: ISODate, items: UnscheduledItem[]) {
		unscheduledByDate = { ...unscheduledByDate, [date]: items };
	}

	const hasAnyUnscheduled = $derived(
		dates.some((d) => (unscheduledByDate[d]?.length ?? 0) > 0),
	);

	const totalUnscheduled = $derived(
		dates.reduce((n, d) => n + (unscheduledByDate[d]?.length ?? 0), 0),
	);

	// ── Resurfaced backlog nudges ──
	// A backlog entry with a resurface date surfaces on exactly one day; the Day
	// and Grid views already show those as nudges, and the week strip mirrors them
	// per column. They live in the backlog file until the arrow inserts them.
	let backlogEntries = $state<BacklogEntry[]>([]);

	const surfacedByDate = $derived.by(() => {
		const today = todayISO();
		const map: Record<string, BacklogEntry[]> = {};
		for (const date of dates) map[date] = surfacedOn(backlogEntries, date, today);
		return map;
	});
	const totalSurfaced = $derived(
		dates.reduce((n, d) => n + (surfacedByDate[d]?.length ?? 0), 0),
	);
	let resurfacingOpen = $state(true);

	function onNudgeInsert(entry: BacklogEntry, date: ISODate) {
		void insertEntry(index, entry, date);
	}
	function onNudgeResurfaceTomorrow(entry: BacklogEntry) {
		resurfaceTomorrow(index, backlogEntries, entry);
	}

	// Resurface-at datepicker, owned here (not by a column) so it isn't clipped.
	let resurfaceEntry = $state<BacklogEntry | null>(null);
	let resurfaceAnchor = $state<DOMRect | null>(null);
	let resurfaceValue = $state<Date>(dateFromISO(todayISO()));
	// Placed off-screen until measured so it never flashes at the anchor before
	// being clamped into the viewport.
	let resurfacePopupEl = $state<HTMLElement>();
	let resurfaceStyle = $state("left: -9999px; top: -9999px;");
	function onNudgeResurfaceAt(entry: BacklogEntry, anchor: DOMRect) {
		resurfaceStyle = "left: -9999px; top: -9999px;"; // hide until measured
		resurfaceEntry = entry;
		resurfaceAnchor = anchor;
		resurfaceValue = dateFromISO(entry.resurface ?? todayISO());
	}
	function closeResurfaceAt() {
		resurfaceEntry = null;
		resurfaceAnchor = null;
	}
	$effect(() => {
		const el = resurfacePopupEl;
		const anchor = resurfaceAnchor;
		if (!el || !anchor) return;
		resurfaceStyle = placeUnderAnchor(anchor, {
			width: el.offsetWidth,
			height: el.offsetHeight,
		});
	});
	function onResurfaceAtSelect(picked: Date) {
		const entry = resurfaceEntry;
		closeResurfaceAt();
		if (entry) setResurface(index, backlogEntries, entry, isoFromDate(picked));
	}

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			},
		};
	}

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

	// ── Block picker (nest-under-block), shared/week-level ──
	// A column forwards a nest request here so the picker escapes its clip. The
	// pick routes back to the owning column's `applyNest`.
	let blockPickerTarget = $state<{
		date: ISODate;
		owner: Block;
		task: Task;
	} | null>(null);
	let blockPickerAnchor = $state<DOMRect | null>(null);

	// Options are the target column's blocks, minus the task's current owner.
	const blockPickerOptions = $derived.by<BlockOption[]>(() => {
		if (!blockPickerTarget) return [];
		const col = columns[blockPickerTarget.date];
		if (!col) return [];
		return blockOptions(
			col.currentBlocksArray(),
			blockPickerTarget.owner.source.line,
		);
	});

	function openBlockPicker(
		date: ISODate,
		owner: Block,
		task: Task,
		anchor: DOMRect,
	) {
		blockPickerTarget = { date, owner, task };
		blockPickerAnchor = anchor;
	}
	function closeBlockPicker() {
		blockPickerTarget = null;
		blockPickerAnchor = null;
	}
	function onPickBlock(option: BlockOption) {
		if (blockPickerTarget) {
			columns[blockPickerTarget.date]?.applyNest(
				blockPickerTarget.owner,
				blockPickerTarget.task,
				option.block,
			);
		}
		closeBlockPicker();
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
			// Cancel any live task drag first, then clear selections.
			for (const date of dates) columns[date]?.cancelTaskDrag();
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

	// The timeline scroll reserves a stable scrollbar gutter so its columns don't
	// resize when the scrollbar toggles. The header + unscheduled strips sit
	// outside that scroll, so to stay aligned they must reserve the same trailing
	// width — the actual scrollbar width, measured once and published as a CSS var
	// on the root. `stable` guarantees the gutter is always present, so the columns
	// underneath always line up with the reserve above.
	let viewEl = $state<HTMLDivElement>();
	function measureScrollbar(el: HTMLElement) {
		const probe = document.createElement("div");
		probe.style.cssText =
			"position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;";
		el.appendChild(probe);
		const width = probe.offsetWidth - probe.clientWidth;
		probe.remove();
		el.style.setProperty("--wv-scrollbar", `${width}px`);
	}

	onMount(() => {
		if (viewEl) measureScrollbar(viewEl);
		const unsubscribeResolver = index.resolver().subscribe((r) => {
			resolve = r;
		});
		const unsubscribeBacklog = index.backlog().subscribe((e) => {
			backlogEntries = e;
		});
		const move = (e: PointerEvent) => onWindowPointerMove(e);
		const up = (e: PointerEvent) => void onWindowPointerUp(e);
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		return () => {
			unsubscribeResolver();
			unsubscribeBacklog();
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
	});

	void notePathForDate;
	void ensureNoteForDate;
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="week-view" tabindex="-1" bind:this={viewEl} onclick={handleClickOutside} onkeydown={onKeyDown}>
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
				aria-label="Timeline settings"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
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
					<label class="controls-field">
						<span class="controls-label">Days before today</span>
						<input type="number" class="controls-input" min="1" max="7" value={before} oninput={(e) => setDaysBefore(+e.currentTarget.value)} />
					</label>
					<label class="controls-field">
						<span class="controls-label">Days after today</span>
						<input type="number" class="controls-input" min="1" max="7" value={after} oninput={(e) => setDaysAfter(+e.currentTarget.value)} />
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
				class="col-head date-card"
				class:today={isToday(date)}
				title="Ctrl+click to open the daily note"
				onclick={(e) => {
					e.stopPropagation();
					if (e.ctrlKey || e.metaKey) columns[date]?.openNote();
				}}
			>
				<span class="dow-label">{dowLabel(date)}</span>
				<span class="date-number">{dayNumber(date)}</span>
				{#if isToday(date)}
					<span class="today-indicator"></span>
				{/if}
			</button>
		{/each}
	</div>

	{#if hasAnyUnscheduled}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="week-unscheduled">
			<div
				class="week-us-header"
				class:open={unscheduledOpen}
				onclick={() => (unscheduledOpen = !unscheduledOpen)}
			>
				<div class="week-us-gutter-spacer">
					<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="us-chevron"><path d="m6 9 6 6 6-6"/></svg>
					<span>Unscheduled</span>
					<span class="us-count">{totalUnscheduled}</span>
				</div>
				{#each dates as date (date)}
					<div class="week-us-head-cell"></div>
				{/each}
			</div>
			{#if unscheduledOpen}
				<div class="week-us-body">
					<div class="week-us-gutter-spacer"></div>
					{#each dates as date (date)}
						<div class="week-us-col" class:today={isToday(date)}>
							{#each unscheduledByDate[date] ?? [] as { block, task } (task.source.line)}
								{@const r = task.owner ? columns[date]?.resolveAssoc(task.owner) : undefined}
								<TaskRow
									{task}
									color={r?.color}
									association={task.assoc ?? task.owner}
									inherited={task.assoc === undefined && task.owner !== undefined}
									resolved={r}
									onNavigate={() => task.owner && columns[date]?.navigateAssoc(task.owner)}
									onEditAssoc={(rect) => columns[date]?.editTaskAssoc(block, task, rect)}
									onNest={(rect) => columns[date]?.nestTask(block, task, rect)}
									onMoveToBacklog={() => columns[date]?.moveToBacklog(block, task)}
									onSetStatus={(_t, status) => columns[date]?.setTaskStatus(block, task, status)}
									onSetText={(_t, text) => columns[date]?.setTaskText(block, task, text)}
									onDelete={(_t) => columns[date]?.deleteTask(block, task)}
									onGrab={(e) => columns[date]?.grabTask(block, task, e)}
								/>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Resurfacing: backlog nudges due somewhere in the window. A strip of its
	     own, like Unscheduled, but the items live in the backlog until inserted. -->
	{#if totalSurfaced > 0}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="week-resurfacing">
			<div
				class="week-us-header"
				class:open={resurfacingOpen}
				onclick={() => (resurfacingOpen = !resurfacingOpen)}
			>
				<div class="week-us-gutter-spacer">
					<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="us-chevron"><path d="m6 9 6 6 6-6"/></svg>
					<span>Resurfacing</span>
					<span class="us-count">{totalSurfaced}</span>
				</div>
				{#each dates as date (date)}
					<div class="week-us-head-cell"></div>
				{/each}
			</div>
			{#if resurfacingOpen}
				<div class="week-us-body">
					<div class="week-us-gutter-spacer"></div>
					{#each dates as date (date)}
						<div class="week-us-col week-rs-col">
							{#each surfacedByDate[date] ?? [] as entry (entry.source.line)}
								<BacklogNudge
									{entry}
									resolved={entry.assoc ? resolve(entry.assoc) : undefined}
									onInsert={(e) => onNudgeInsert(e, date)}
									onResurfaceTomorrow={onNudgeResurfaceTomorrow}
									onResurfaceAt={onNudgeResurfaceAt}
									onNavigate={(assoc) =>
										navigateToAssociation(app, resolve(assoc))}
								/>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

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
						class:today={isToday(date)}
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
							onNestTask={openBlockPicker}
							backlogPath={settings.backlogPath}
							{onCrossDayGrab}
							askAssocOnCreate={settings.askAssocOnBlockCreate}
							showUnscheduled={false}
							{onUnscheduledChange}
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

{#if resurfaceEntry && resurfaceAnchor}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="resurface-popup"
		use:portal
		bind:this={resurfacePopupEl}
		style={resurfaceStyle}
		onclick={(e) => e.stopPropagation()}
	>
		<Datepicker inline bind:value={resurfaceValue} onselect={onResurfaceAtSelect} />
	</div>
{/if}

{#if blockPickerTarget && blockPickerAnchor}
	<BlockPicker
		options={blockPickerOptions}
		anchor={blockPickerAnchor}
		onPick={onPickBlock}
		onClose={closeBlockPicker}
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
	/* The right padding reserves the timeline scrollbar's width (measured into
	   --wv-scrollbar) on top of the base 10px, so these columns line up with the
	   scroll area below whether or not its scrollbar is showing. */
	.week-colheads {
		display: flex;
		flex-shrink: 0;
		padding: 0 calc(10px + var(--wv-scrollbar, 0px)) 0 10px;
		background: var(--background-secondary);
		background-clip: content-box;
	}

	.week-gutter-spacer {
		width: 46px;
		min-width: 46px;
		/* Carry the gutter's vertical divider up through the header so it reads as one
		   continuous line into the body below, rather than a stray line that begins at
		   the header's bottom edge. The bottom rule lives here (and on the col-heads)
		   so it stops at the real content extents instead of bleeding into the padded
		   flex edges. */
		border-right: 1px solid var(--background-modifier-border);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	/* Holos-style date card: an uppercase day-of-week label over a large serif
	   day number, left-aligned, one per column. Kept identical to the Grid view's
	   .grid-colhead.date-card so the two headers read the same.

	   The two text lines flow normally in the button; the today underline is
	   absolutely positioned in the reserved bottom strip (padding-bottom) so it
	   never overlaps the number. */
	.col-head.date-card {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		background: transparent;
		border: none;
		/* The header's bottom rule; carried on each column cell so it spans exactly the
		   body's column extents (no overhang past the timeline). */
		border-bottom: 1px solid var(--background-modifier-border);
		padding: 8px 8px 12px 12px;
		cursor: pointer;
		box-shadow: none;
		transition: filter 150ms ease;
		height: 100%;
	}

	.col-head.date-card:hover {
		filter: brightness(1.15);
	}

	.col-head .dow-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 1px;
		line-height: 1.4;
	}

	.col-head .date-number {
		font-family: Georgia, "Times New Roman", serif;
		font-size: 24px;
		font-weight: 400;
		color: var(--text-normal);
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}

	.col-head .today-indicator {
		position: absolute;
		left: 10%;
		bottom: -2px;
		width: 80%;
		height: 2px;
		background: var(--interactive-accent);
		border-radius: 1px;
	}

	.col-head.today {
		background: color-mix(in srgb, var(--interactive-accent) 5%, transparent);
	}
	/* ── Body ── */
	.week-scroll {
		flex: 1;
		overflow: auto;
		/* Always reserve the scrollbar gutter so the columns keep a constant width
		   (and stay aligned with the header/unscheduled strips, which reserve the
		   same width via --wv-scrollbar) whether or not the scrollbar is showing. */
		scrollbar-gutter: stable;
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
		background: var(--background-secondary);
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

	/* Faint tint marking the currently active day's column. */
	.week-col.today {
		background: color-mix(in srgb, var(--interactive-accent) 5%, transparent);
	}

	/* Cross-day drag affordances. */
	.week-col.drop-target {
		background: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
		box-shadow: inset 0 0 0 2px var(--interactive-accent);
	}
	.week-col.drop-target :global(.col-canvas) {
		background: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
	}

	/* ── Week-level unscheduled strip (above the timeline scroll) ── */
	.week-unscheduled {
		flex-shrink: 0;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.week-us-header {
		display: flex;
		align-items: center;
		cursor: pointer;
		user-select: none;
		/* Match .week-us-body's insets (incl. the reserved scrollbar gutter) so the
		   header divider cells line up with the body columns and the timeline. */
		padding: 0 calc(10px + var(--wv-scrollbar, 0px)) 0 10px;
	}

	.week-us-header:hover {
		background: var(--background-modifier-hover);
	}

	.week-us-gutter-spacer {
		width: 46px;
		min-width: 46px;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		flex-shrink: 0;
		border-right: 1px solid var(--background-modifier-border);
	}
	.week-us-header .week-us-gutter-spacer {
		border: none;
	}

	.week-us-header:hover .week-us-gutter-spacer {
		color: var(--text-normal);
	}

	.week-us-head-cell {
		flex: 1;
		min-width: 0;
		border-left: 1px solid var(--background-modifier-border);
	}

	.week-us-head-cell:first-of-type {
		border-left: none;
	}

	.us-chevron {
		transition: transform 0.15s;
		transform: rotate(-90deg);
		flex-shrink: 0;
	}

	.week-us-header.open .us-chevron {
		transform: rotate(0deg);
	}

	.us-count {
		font-size: 10px;
		font-weight: 400;
		color: var(--text-faint);
	}

	.week-us-body {
		display: flex;
		/* Reserve the timeline scrollbar gutter on the right so these columns stay
		   aligned with the scroll area below (see .week-colheads). */
		padding: 0 calc(10px + var(--wv-scrollbar, 0px)) 0 10px;
	}

	.week-us-col {
		flex: 1;
		min-width: 0;
		border-left: 1px solid var(--background-modifier-border);
	}

	.week-us-col:first-child {
		border-left: none;
	}

	.week-us-col.today {
		background: color-mix(in srgb, var(--interactive-accent) 5%, transparent);
	}

	/* ── Resurfacing (backlog nudges due in the window) ── */
	.week-resurfacing {
		flex-shrink: 0;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	/* Nudges carry their own accent tint, so give them a little breathing room
	   the plain task rows above don't need. */
	.week-rs-col {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 3px 4px;
	}

	:global(.resurface-popup) {
		position: fixed;
		z-index: 1000;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: var(--shadow-s);
		padding: 4px;
	}
</style>
