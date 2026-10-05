<script lang="ts">
	// The Gantt / strength view — "the old season view reborn". A retrospective
	// visualization of active/inactive spans and note-driven intensity across time,
	// computed entirely from the history arrays (no stored spans). It is also the
	// primary editing surface: dragging a span boundary moves the date of the
	// record that begins the later span, and clicking a span opens a popup to edit
	// its status/note — both routing through the same guarded edit functions the
	// Projects page uses (projectActions → index → projectFile invariants).
	//
	// Rows mirror the Projects page grouping: each domain, its child projects
	// nested beneath, then unassigned (orphan) projects. Same data as the Projects
	// page — different question (retrospective spans vs. present snapshot). Which
	// of them earn a row depends on the viewport, not on today alone (gantt/rows).

	import { onMount } from "svelte";
	import { Menu } from "obsidian";
	import type { App } from "obsidian";
	import type { Unsubscriber } from "svelte/store";
	import type { Domain, ISODate, LifecycleState, Project, StatusRecord } from "../../types";
	import type { KairosIndex, ProjectsDomains } from "../../index";
	import { dateFromISO, isoFromDate, todayISO } from "../../dayNote";
	import {
		editDomainStatusRecord,
		editProjectStatusRecord,
		removeDomainStatusRecord,
		removeProjectStatusRecord,
		setDomainActivePeriod,
		setDomainStatus,
		setProjectActivePeriod,
		setProjectStatus,
	} from "../../projectActions";
	import {
		BAR_HEIGHT,
		HEADER_COARSE_HEIGHT,
		HEADER_FINE_HEIGHT,
		HEADER_HEIGHT,
		INTERVALS,
		INTERVAL_LABEL,
		LABEL_WIDTH,
		ROW_GAP,
		ROW_HEIGHT,
		dateToX,
		getHeader,
		getUnitViewport,
		daysBetween,
		shiftDays,
		stepUnit,
		unitLabel,
		xToDate,
		xToDay,
		type Interval,
	} from "../../gantt/ganttUtils";
	import { historyToSpans, type Span } from "../../gantt/spans";
	import { visibleEntities } from "../../gantt/rows";
	import Datepicker from "../components/Datepicker.svelte";
	import Portal from "../components/Portal.svelte";
	import RowLabel from "../components/RowLabel.svelte";
	import { rowLabelInfo, type RowLabelInfo } from "../components/rowLabel";

	interface Props {
		app: App;
		index: KairosIndex;
	}
	let { index }: Props = $props();

	// ── Feed ──
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

	const today = $derived(todayISO());

	// ── Viewport / interval / pan ──
	// The view snaps to whole calendar units. `interval` picks the unit granularity
	// (week/month/quarter/year); `anchor` is any date inside the shown unit, and the
	// viewport is the whole unit containing it. Stepping moves by one unit; "Today"
	// snaps back to the unit containing today.
	let interval = $state<Interval>("month");
	// Seed from the raw function (not the `today` derived) so this init doesn't
	// capture a reactive value — `anchor` is user-driven from here on.
	let anchor = $state<ISODate>(todayISO());
	const viewport = $derived(getUnitViewport(interval, anchor));
	// Number of whole days the current unit spans (drives px-per-day).
	const unitDays = $derived(daysBetween(viewport.start, viewport.end) + 1);
	const atToday = $derived(
		today >= viewport.start && today <= viewport.end,
	);

	// Measure the plotting area to compute pixels-per-day (the unit fills the width).
	let plotWidth = $state(0);
	const pxPerDay = $derived(plotWidth > 0 ? plotWidth / unitDays : 0);
	const header = $derived(getHeader(interval, viewport.start, viewport.end, pxPerDay));
	// Today marker sits on the *left boundary* of today's column, aligning with the
	// date-on-line header labels (which mark day boundaries, not column centers).
	const todayX = $derived(dateToX(today, viewport.start, pxPerDay));

	// ── A row is one entity (domain or project) plus its label / color / kind ──
	interface GanttRow {
		key: string; // source.path (stable identity for keyed each)
		entity: Domain | Project;
		isDomain: boolean;
		label: string;
		indent: boolean; // child project under a domain
		color: string; // base hue; "" → neutral accent
		info: RowLabelInfo; // presentation for the sidebar label + hover card
	}

	// Archived entities drop out of the row axis, but window-aware rather than
	// flat (see gantt/rows.ts): one keeps its row for a viewport it was active in,
	// so panning back to a season still draws the bars that were worked then.
	const visible = $derived(
		visibleEntities(feed, viewport.start, viewport.end, today),
	);

	const rows = $derived.by<GanttRow[]>(() => {
		const out: GanttRow[] = [];
		for (const { domain, projects } of visible.domains) {
			const color = domain.color || undefined;
			out.push({
				key: domain.source.path,
				entity: domain,
				isDomain: true,
				label: domain.name,
				indent: false,
				color: domain.color,
				info: rowLabelInfo(domain, true, color, today),
			});
			for (const p of projects) {
				out.push({
					key: p.source.path,
					entity: p,
					isDomain: false,
					label: p.name,
					indent: true,
					color: domain.color, // inherit domain hue
					info: rowLabelInfo(p, false, color, today),
				});
			}
		}
		for (const p of visible.orphans) {
			out.push({
				key: p.source.path,
				entity: p,
				isDomain: false,
				label: p.name,
				indent: false,
				color: "",
				info: rowLabelInfo(p, false, undefined, today),
			});
		}
		return out;
	});

	// Group flags for the continuous accent stripe: a domain + its child projects
	// share one unbroken stripe. A child continues the group; a domain or orphan
	// opens a new one.
	function ganttGroup(i: number): { start: boolean; end: boolean } {
		const row = rows[i]!;
		const next = rows[i + 1];
		return { start: !row.indent, end: !(next?.indent) };
	}

	function pan(dir: 1 | -1) {
		anchor = stepUnit(interval, viewport.start, dir);
	}
	function jumpToday() {
		anchor = today;
	}
	function setInterval(next: Interval) {
		// Keep the same anchor date visible when changing granularity.
		interval = next;
	}

	// ── Header calendar (pick the unit to jump to) ──
	// The user picks any day; we snap to the unit of the current interval that
	// contains it (there is no precise per-day navigation at this altitude).
	let showCalendar = $state(false);
	let calendarValue = $state<Date>(dateFromISO(todayISO()));
	let dateNavRef = $state<HTMLDivElement>();
	function onCalendarSelect(picked: Date) {
		anchor = isoFromDate(picked);
		showCalendar = false;
	}
	function handleClickOutside(event: MouseEvent) {
		if (showCalendar && dateNavRef && !dateNavRef.contains(event.target as Node)) {
			showCalendar = false;
		}
	}

	const rowTop = (i: number) => HEADER_HEIGHT + i * (ROW_HEIGHT + ROW_GAP);
	const contentHeight = $derived(rowTop(rows.length) + ROW_GAP);

	// Base hue for a row: its color, or the theme accent when none.
	const barColor = (row: GanttRow) => row.color || "var(--interactive-accent)";

	// ── Span geometry: clamp to the viewport so off-screen spans don't overflow ──
	// Boundaries are drawn *on the grid lines that delimit the labeled days*, and
	// those lines are now labeled by date (date-on-line header). A span's right edge
	// therefore lands on the boundary of the day it ends:
	//   • bounded span → its `end` is the date it went inactive; the bar fills up to
	//     that boundary (the last active day is end−1). Right edge = dateToX(end).
	//   • open span → still running; it fills *through* today, so the right edge is
	//     dateToX(today+1). `spans.ts` sets an open span's `end` to today, so we add
	//     one day only in the open case.
	// This kills the old off-by-one where an active-through-the-23rd bar reached the
	// line labeled "24".
	interface SpanBox {
		left: number;
		width: number;
		clampedStart: boolean; // true when the real start is off-screen to the left
		clampedEnd: boolean; // true when the real end is off-screen to the right
	}
	function spanBox(span: Span): SpanBox | null {
		// The exclusive right boundary date the bar reaches.
		const endBoundary = span.open ? shiftDays(span.end, 1) : span.end;
		const clampedStart = span.start < viewport.start;
		const clampedEnd = endBoundary > shiftDays(viewport.end, 1);
		const start = clampedStart ? viewport.start : span.start;
		const rightDate = clampedEnd ? shiftDays(viewport.end, 1) : endBoundary;
		if (rightDate <= viewport.start || start > viewport.end) return null; // off-screen
		const left = dateToX(start, viewport.start, pxPerDay);
		const right = dateToX(rightDate, viewport.start, pxPerDay);
		return { left, width: Math.max(3, right - left), clampedStart, clampedEnd };
	}

	// ── Pointer model ──────────────────────────────────────────────────────────
	//
	// Only *active* spans are drawn (inactivity is the absence of a bar). Every edit
	// is a press-drag-release on the plot; the intent is fixed at press-time by what
	// was under the pointer:
	//
	//  • "start"  — the left edge of an active bar. Drag moves the `active` record's
	//               date (the span's start), clamped after the previous record.
	//  • "end"    — the right edge of an active bar. For a *bounded* span it moves
	//               the closing `inactive` record; for an *open-ended* span it
	//               *creates* one at the release date (giving the indefinite bar an
	//               end). Releasing at/after today leaves it open (no record).
	//  • "create" — empty space in a row. A click-in-place adds one open-ended
	//               `active` record at that date; a click-drag adds an `active` at
	//               the earlier date and an `inactive` at the later, i.e. a bounded
	//               active period. Either way the note editor opens on release.
	//
	// A date snaps to whole days (`xToDate`). We clamp against neighbouring records
	// so chronological order and one-per-date can never break.
	type DragKind = "start" | "end" | "create";
	interface Drag {
		kind: DragKind;
		row: GanttRow;
		anchorDate: ISODate; // press date (create) / the record being moved (start,end)
		lowerDate: ISODate | null; // exclusive lower clamp (record before)
		upperDate: ISODate | null; // exclusive upper clamp (record after)
		open: boolean; // end-drag on an open-ended span (create the inactive record)
		preview: ISODate; // current snapped date under the pointer
		moved: boolean; // pointer left the origin day → a drag, not a click
	}
	let drag = $state<Drag | null>(null);
	let plotEl = $state<HTMLDivElement>();

	// A note for a newly-created active record that is guaranteed *not* to collapse
	// against the active record in effect immediately before `start`. When the click
	// lands inside an existing active span (same status), an identical note would be
	// dropped as a no-op transition, so we pick a default that differs from the
	// predecessor's note. Empty history / non-active predecessor → no note needed.
	function boundaryNote(history: StatusRecord[], start: ISODate): string | undefined {
		let prev: StatusRecord | undefined;
		for (const r of history) {
			if (r.date < start) prev = r;
			else break;
		}
		if (!prev || prev.status !== "active") return undefined; // won't collapse
		const prevNote = (prev.note ?? "").trim().toLowerCase();
		return prevNote === "baseline" ? "active" : "baseline";
	}

	function pointerX(e: PointerEvent): number {
		const rect = plotEl?.getBoundingClientRect();
		return rect ? e.clientX - rect.left : e.clientX;
	}
	// Edge drags snap to the nearest day *boundary* (round); create/click resolves
	// the day *column* under the cursor (floor) so the picked date is the one the
	// pointer is visibly over, not whichever boundary happens to be closer.
	function pointerDate(e: PointerEvent): ISODate {
		return xToDate(pointerX(e), viewport.start, pxPerDay);
	}
	function pointerDay(e: PointerEvent): ISODate {
		return xToDay(pointerX(e), viewport.start, pxPerDay);
	}

	function clamp(date: ISODate, lower: ISODate | null, upper: ISODate | null): ISODate {
		let d = date;
		if (lower && d <= lower) d = shiftDays(lower, 1);
		if (upper && d >= upper) d = shiftDays(upper, -1);
		return d;
	}

	/** Press on a bar edge: move (or, for an open span's end, create) a boundary. */
	function beginEdgeDrag(
		e: PointerEvent,
		kind: "start" | "end",
		row: GanttRow,
		span: Span,
		history: StatusRecord[],
	) {
		e.stopPropagation();
		e.preventDefault();
		const startIdx = history.findIndex((r) => r.date === span.start);
		if (startIdx < 0) return;
		// The record whose date we edit: the span's opener (start) or its closer (end).
		const closerIdx = startIdx + 1; // the `inactive` record that ends a bounded span
		const open = kind === "end" && span.open;
		const anchorDate = kind === "start" ? span.start : open ? span.end : history[closerIdx]!.date;
		drag = {
			kind,
			row,
			anchorDate,
			// start: clamp above the previous record; end: clamp above the span's own start.
			lowerDate:
				kind === "start"
					? startIdx > 0 ? history[startIdx - 1]!.date : null
					: span.start,
			// start: below the closer (if any); end: below the record after the closer.
			upperDate:
				kind === "start"
					? history[closerIdx]?.date ?? null
					: open ? null : history[closerIdx + 1]?.date ?? null,
			open,
			preview: anchorDate,
			moved: false,
		};
		// Capture on the plot (stable across re-renders), not the pressed child —
		// child bars/zones re-render mid-drag, which would drop a child capture and
		// silently end the gesture.
		plotEl?.setPointerCapture?.(e.pointerId);
	}

	/** Press on empty row space: create a new active period. */
	function beginCreateDrag(e: PointerEvent, row: GanttRow) {
		if (pxPerDay <= 0) return;
		e.preventDefault();
		// Pressing empty canvas clears any bar selection.
		selectedKey = null;
		const history = row.entity.history;
		const date = pointerDay(e);
		// Clamp to the gaps between existing records so a create can't collide.
		let lower: ISODate | null = null;
		let upper: ISODate | null = null;
		for (const r of history) {
			if (r.date < date) lower = r.date;
			else if (upper === null) upper = r.date;
		}
		drag = {
			kind: "create",
			row,
			anchorDate: date,
			lowerDate: lower,
			upperDate: upper,
			open: false,
			preview: date,
			moved: false,
		};
		plotEl?.setPointerCapture?.(e.pointerId);
	}

	function moveDrag(e: PointerEvent) {
		if (!drag || pxPerDay <= 0) return;
		// Create resolves the day-column under the cursor; edge drags snap to the
		// nearest boundary.
		const raw = drag.kind === "create" ? pointerDay(e) : pointerDate(e);
		const next = clamp(raw, drag.lowerDate, drag.upperDate);
		drag = { ...drag, preview: next, moved: drag.moved || next !== drag.anchorDate };
	}

	function endDrag() {
		if (!drag) return;
		const d = drag;
		drag = null;
		const isDomain = d.row.isDomain;
		const domain = d.row.entity as Domain;
		const project = d.row.entity as Project;

		if (d.kind === "create") {
			const [start, end] = d.anchorDate <= d.preview
				? [d.anchorDate, d.preview]
				: [d.preview, d.anchorDate];
			// If the new active record would sit right after another active one with an
			// identical note, `normalizeHistory` collapses it (a no-op transition) and
			// nothing is written — so the popup would have no record to edit. That case
			// is exactly "click inside an existing active span to change intensity", so
			// seed a distinguishing note; the popup lets the user rename it immediately.
			const note = boundaryNote(d.row.entity.history, start);
			if (!d.moved || start === end) {
				// Click → open-ended active (splits an existing open span at `start`).
				if (isDomain) setDomainStatus(index, domain, start, "active", note);
				else setProjectStatus(index, project, start, "active", note);
			} else if (isDomain) {
				setDomainActivePeriod(index, domain, start, end, note);
			} else {
				setProjectActivePeriod(index, project, start, end, note);
			}
			// A fresh period gets the seeded distinguishing note; the user double-clicks
			// the bar to rename it (no auto-opened editor — the popup is gone).
			return;
		}

		if (d.kind === "end" && d.open) {
			// Give an indefinite bar an end: insert `inactive` at the release date
			// (the close can be today, past, or future — a future close simply
			// schedules the project to go inactive then). Released in place → leave
			// it open. The clamp already keeps the date strictly after the start.
			if (!d.moved || d.preview === d.anchorDate) return;
			if (isDomain) setDomainStatus(index, domain, d.preview, "inactive");
			else setProjectStatus(index, project, d.preview, "inactive");
			return;
		}

		// A click-in-place (no drag) on a *bounded* span's right edge converts it to
		// indefinite: drop the closing `inactive` record so the span runs open again.
		// (The `end` + `open` case above already handled open spans; this is the
		// bounded end-drag whose closer date is `d.anchorDate`.)
		if (d.kind === "end" && (!d.moved || d.preview === d.anchorDate)) {
			if (isDomain) removeDomainStatusRecord(index, domain, d.anchorDate);
			else removeProjectStatusRecord(index, project, d.anchorDate);
			return;
		}

		// Move an existing boundary (start record, or a bounded span's closer).
		if (!d.moved || d.preview === d.anchorDate) return;
		const rec = d.row.entity.history.find((r) => r.date === d.anchorDate);
		if (!rec) return;
		const next = { date: d.preview, status: rec.status, note: rec.note ?? "" };
		if (isDomain) editDomainStatusRecord(index, domain, d.anchorDate, next);
		else editProjectStatusRecord(index, project, d.anchorDate, next);
	}

	// ── Bar interaction model ───────────────────────────────────────────────────
	// A bar is always active, so there's no status to pick. The fast-path gestures
	// (drag edges to retime, click empty space to create, hover-x / Delete-key to
	// remove, double-click to rename) cover the common edits; the right-click menu
	// is the home for precise control (calendar date entry, definite↔indefinite).
	//
	// A span has no stored identity, so we key it by row + its opening date, which is
	// unique within a row (one record per date). Resolving the *current* row by its
	// stable key each time matters: a captured `row.entity` goes stale the instant an
	// edit writes (the index republishes a new entity), so any follow-up edit must
	// re-read from the live `rows` or it re-persists an out-of-date history.
	function spanKey(rowKey: string, start: ISODate): string {
		return `${rowKey}::${start}`;
	}
	function currentRow(key: string): GanttRow | undefined {
		return rows.find((r) => r.key === key);
	}

	// ── Selection (single-click) ──
	// The selected span, so Delete removes it and it draws an outline. Cleared on
	// Escape or a click on empty plot space.
	let selectedKey = $state<string | null>(null);
	function selectSpan(row: GanttRow, span: Span) {
		if (drag) return; // a drag just ended — the pointerup fired a click too
		selectedKey = spanKey(row.key, span.start);
		// Focus the plot so it receives the Delete / Escape keys for this selection.
		plotEl?.focus({ preventScroll: true });
	}

	// Resolve the selected span back to its row + span so Delete can act on it.
	function selectedTarget(): { row: GanttRow; span: Span } | null {
		if (!selectedKey) return null;
		for (const row of rows) {
			for (const span of historyToSpans(row.entity.history, today)) {
				if (span.status === "active" && spanKey(row.key, span.start) === selectedKey) {
					return { row, span };
				}
			}
		}
		return null;
	}

	// Delete removes the selected period; Escape clears selection (and closes an
	// in-place edit / menu first). Ignored while typing in the description input.
	function onPlotKeyDown(e: KeyboardEvent) {
		const t = e.target;
		if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.isContentEditable)) return;
		const key = e.key;
		if (key === "Delete" || key === "Backspace") {
			const target = selectedTarget();
			if (!target) return;
			e.preventDefault();
			deletePeriod(target.row, target.span);
		} else if (key === "Escape") {
			if (editingKey) { cancelEditDesc(); return; }
			selectedKey = null;
		}
	}

	// ── In-place description editing (double-click) ──
	// The bar's label becomes an input seeded with the span's note; committing writes
	// it back through the same guarded record edit the drags use, keeping the start
	// date and status untouched.
	let editingKey = $state<string | null>(null);
	let editingText = $state("");
	function beginEditDesc(row: GanttRow, span: Span) {
		if (drag) return;
		editingKey = spanKey(row.key, span.start);
		editingText = span.note ?? "";
	}
	function commitEditDesc(row: GanttRow, span: Span) {
		const key = spanKey(row.key, span.start);
		if (editingKey !== key) return;
		editingKey = null;
		const live = currentRow(row.key);
		if (!live) return;
		const next = { date: span.start, status: "active" as LifecycleState, note: editingText.trim() };
		if (live.isDomain) editDomainStatusRecord(index, live.entity as Domain, span.start, next);
		else editProjectStatusRecord(index, live.entity as Project, span.start, next);
	}
	function cancelEditDesc() {
		editingKey = null;
	}

	// ── Delete a whole active period ──
	// Removes the opening `active` record and, if the span is bounded, the closing
	// `inactive` record too — so deleting a definite period leaves no orphaned
	// closer behind. (An open span has only the opener.)
	function deletePeriod(row: GanttRow, span: Span) {
		const live = currentRow(row.key);
		if (!live) return;
		if (selectedKey === spanKey(row.key, span.start)) selectedKey = null;
		const remove = (date: ISODate) => {
			if (live.isDomain) removeDomainStatusRecord(index, live.entity as Domain, date);
			else removeProjectStatusRecord(index, live.entity as Project, date);
		};
		// Remove the closer first: `remove` re-reads the live entity each call, and
		// dropping the opener first would renormalize the history and could shift what
		// the closer date resolves to. The closer is the record right after the opener.
		if (!span.open) {
			const hist = live.entity.history;
			const openerIdx = hist.findIndex((r) => r.date === span.start);
			const closer = openerIdx >= 0 ? hist[openerIdx + 1] : undefined;
			if (closer) remove(closer.date);
		}
		remove(span.start);
	}

	// ── Convert definite → indefinite ──
	// Drop the closing `inactive` record so the span runs open-ended again. Invoked
	// by a click-in-place on a bounded bar's right edge, or the context menu.
	function reopenSpan(row: GanttRow, span: Span) {
		if (span.open) return;
		const live = currentRow(row.key);
		if (!live) return;
		const hist = live.entity.history;
		const openerIdx = hist.findIndex((r) => r.date === span.start);
		const closer = openerIdx >= 0 ? hist[openerIdx + 1] : undefined;
		if (!closer) return;
		if (live.isDomain) removeDomainStatusRecord(index, live.entity as Domain, closer.date);
		else removeProjectStatusRecord(index, live.entity as Project, closer.date);
	}

	// ── Right-click context menu (precise control) ──
	// A native Obsidian Menu (matching TimelineBlock / ProjectsView) shown at the
	// pointer. Items differ by span kind: a bounded span can be reopened; an open
	// span's "Set end date" is what makes it definite.
	function openMenu(e: MouseEvent, row: GanttRow, span: Span) {
		e.preventDefault();
		e.stopPropagation();
		selectedKey = spanKey(row.key, span.start);
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle("Edit description").setIcon("pencil").onClick(() => beginEditDesc(row, span)),
		);
		menu.addItem((item) =>
			item.setTitle("Edit start date…").setIcon("calendar").onClick(() => openDateEdit(row, span, "start")),
		);
		if (span.open) {
			menu.addItem((item) =>
				item.setTitle("Set end date…").setIcon("calendar-clock").onClick(() => openDateEdit(row, span, "end")),
			);
		} else {
			menu.addItem((item) =>
				item.setTitle("Edit end date…").setIcon("calendar-clock").onClick(() => openDateEdit(row, span, "end")),
			);
			menu.addItem((item) =>
				item.setTitle("Convert to indefinite").setIcon("infinity").onClick(() => reopenSpan(row, span)),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle("Delete").setIcon("trash").onClick(() => deletePeriod(row, span)),
		);
		menu.showAtMouseEvent(e);
	}

	// ── Calendar popup for precise start/end date entry (from the menu) ──
	// `which` records whether we're moving the opener (start) or the closer (end);
	// for an open span, picking an end date inserts the closer (convert → definite).
	interface DateEdit {
		row: GanttRow;
		span: Span;
		which: "start" | "end";
	}
	let dateEdit = $state<DateEdit | null>(null);
	let dateEditValue = $state<Date>(new Date());
	function openDateEdit(row: GanttRow, span: Span, which: "start" | "end") {
		const seed = which === "start" ? span.start : span.open ? span.end : closerDate(row, span) ?? span.end;
		dateEdit = { row, span, which };
		dateEditValue = dateFromISO(seed);
	}
	function closerDate(row: GanttRow, span: Span): ISODate | undefined {
		const live = currentRow(row.key);
		if (!live) return undefined;
		const hist = live.entity.history;
		const openerIdx = hist.findIndex((r) => r.date === span.start);
		return openerIdx >= 0 ? hist[openerIdx + 1]?.date : undefined;
	}
	function commitDateEdit(picked: Date) {
		const d = dateEdit;
		dateEdit = null;
		if (!d) return;
		const live = currentRow(d.row.key);
		if (!live) return;
		const pickISO = isoFromDate(picked);
		if (d.which === "start") {
			// Move the opening `active` record; keep its status/note.
			const next = { date: pickISO, status: "active" as LifecycleState, note: d.span.note ?? "" };
			if (live.isDomain) editDomainStatusRecord(index, live.entity as Domain, d.span.start, next);
			else editProjectStatusRecord(index, live.entity as Project, d.span.start, next);
			return;
		}
		// End date: move the existing closer, or insert one (open → definite).
		const closer = closerDate(d.row, d.span);
		if (closer) {
			const next = { date: pickISO, status: "inactive" as LifecycleState };
			if (live.isDomain) editDomainStatusRecord(index, live.entity as Domain, closer, next);
			else editProjectStatusRecord(index, live.entity as Project, closer, next);
		} else {
			if (live.isDomain) setDomainStatus(index, live.entity as Domain, pickISO, "inactive");
			else setProjectStatus(index, live.entity as Project, pickISO, "inactive");
		}
	}

	function formatDate(iso: ISODate): string {
		const [y, m, d] = iso.split("-");
		const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
		return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="gantt-wrap" onclick={handleClickOutside}>
	<!-- Header: shared left navigator (mirrors Grid / Week) + interval selector. -->
	<div class="gantt-header-bar">
		<div class="day-nav" bind:this={dateNavRef}>
			<button
				class="icon-btn nav-btn"
				onclick={(e) => { e.stopPropagation(); pan(-1); }}
				aria-label="Previous"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
			</button>

			<button
				class="day-date"
				title="Click to jump to a {INTERVAL_LABEL[interval].toLowerCase()}"
				onclick={(e) => { e.stopPropagation(); showCalendar = !showCalendar; }}
			>
				{unitLabel(interval, viewport.start)}
			</button>

			<button
				class="icon-btn nav-btn"
				onclick={(e) => { e.stopPropagation(); pan(1); }}
				aria-label="Next"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
			</button>

			{#if !atToday}
				<button class="today-btn" onclick={(e) => { e.stopPropagation(); jumpToday(); }}>Today</button>
			{/if}

			{#if showCalendar}
				<div class="calendar-popup">
					<Datepicker inline bind:value={calendarValue} onselect={onCalendarSelect} />
				</div>
			{/if}
		</div>

		<span class="gc-spacer"></span>

		<div class="interval-tabs">
			{#each INTERVALS as iv}
				<button
					class="interval-tab"
					class:active={interval === iv}
					onclick={(e) => { e.stopPropagation(); setInterval(iv); }}
				>
					{INTERVAL_LABEL[iv]}
				</button>
			{/each}
		</div>
	</div>

	{#if rows.length === 0}
		<!-- An empty axis means one of two different things: nothing exists yet, or
		     everything that exists is archived with no activity in this period. -->
		<div class="gantt-empty">
			{feed.domains.length === 0 && feed.orphans.length === 0
				? "No projects or domains yet."
				: "Nothing was active in this period."}
		</div>
	{:else}
		<div class="gantt-grid">
			<!-- Sidebar labels -->
			<div class="gantt-labels" style:width={`${LABEL_WIDTH}px`}>
				<div class="gantt-corner" style:height={`${HEADER_HEIGHT}px`}></div>
				{#each rows as row, i (row.key)}
					{@const group = ganttGroup(i)}
					<div
						class="gantt-label"
						class:indent={row.indent}
						class:domain={row.isDomain}
						class:group-start={group.start}
						class:group-end={group.end}
						style:height={`${ROW_HEIGHT}px`}
						style:margin-bottom={`${ROW_GAP}px`}
						style={row.color ? `--row-accent: ${row.color};` : undefined}
					>
						<!-- Continuous group accent: a domain + its projects share one stripe.
						     Extends through the row gap on non-terminal rows so it reads as
						     unbroken across the fixed-height, gapped Gantt rows. -->
						<span
							class="gantt-accent"
							style:height={group.end ? `${ROW_HEIGHT}px` : `${ROW_HEIGHT + ROW_GAP}px`}
						></span>
						<RowLabel info={row.info} />
					</div>
				{/each}
			</div>

			<!-- Plot area -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="gantt-plot"
				bind:this={plotEl}
				bind:clientWidth={plotWidth}
				tabindex="-1"
				style:height={`${contentHeight}px`}
				onpointermove={moveDrag}
				onpointerup={endDrag}
				onpointerleave={endDrag}
				onkeydown={onPlotKeyDown}
			>
				<!-- Two-level header: coarse grouping row over a fine row. Fine labels
				     mark the *left boundary* of each column, so a bar edge (which lands
				     on a day boundary) reads against a labeled line — no off-by-one. -->
				<div class="gantt-header" style:height={`${HEADER_HEIGHT}px`}>
					<div class="gantt-header-coarse" style:height={`${HEADER_COARSE_HEIGHT}px`}>
						{#each header.coarse as c}
							<span class="gantt-coarse-label" style:left={`${c.labelX}px`}>{c.label}</span>
							<span class="gantt-coarse-sep" style:left={`${c.gridX}px`}></span>
						{/each}
					</div>
					<div class="gantt-header-fine" style:height={`${HEADER_FINE_HEIGHT}px`} style:top={`${HEADER_COARSE_HEIGHT}px`}>
						{#each header.fine as f}
							<!-- Label sits *on* the boundary line (its day's start), so a bar
							     edge lands on the labeled date. The leftmost tick (gridX≈0)
							     left-aligns so it isn't clipped off the plot edge. -->
							<span class="gantt-fine-label" class:edge={f.gridX < 1} style:left={`${f.gridX}px`}>{f.label}</span>
						{/each}
					</div>
				</div>
				<!-- Fine gridlines at column boundaries; coarse boundaries drawn heavier. -->
				{#each header.fine as f}
					<div class="gantt-gridline" style:left={`${f.gridX}px`} style:top={`${HEADER_HEIGHT}px`} style:height={`${contentHeight - HEADER_HEIGHT}px`}></div>
				{/each}
				{#each header.coarse as c}
					<div class="gantt-gridline coarse" style:left={`${c.gridX}px`} style:top={`${HEADER_COARSE_HEIGHT}px`} style:height={`${contentHeight - HEADER_COARSE_HEIGHT}px`}></div>
				{/each}

				<!-- Today marker (on today's left boundary) -->
				{#if atToday && todayX >= 0 && todayX <= plotWidth}
					<div class="gantt-today" style:left={`${todayX}px`} style:height={`${contentHeight}px`}></div>
				{/if}

				<!-- Create zones: empty row space; press here to author a new active
				     period (click = open-ended, drag = bounded). Sits behind the bars. -->
				{#each rows as row, i (row.key)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="gantt-create-zone"
						style:top={`${rowTop(i)}px`}
						style:height={`${ROW_HEIGHT}px`}
						title="Drag to add an active period · click to start one"
						onpointerdown={(e) => beginCreateDrag(e, row)}
					></div>
				{/each}

				<!-- Active bars only — inactivity is the absence of a bar. -->
				{#each rows as row, i (row.key)}
					{@const history = row.entity.history}
					{@const spans = historyToSpans(history, today)}
					{#each spans as span (span.start)}
						{#if span.status === "active"}
							{@const box = spanBox(span)}
							{#if box}
								{@const openEnded = span.open && !box.clampedEnd}
								{@const key = spanKey(row.key, span.start)}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="gantt-bar"
									class:open-ended={openEnded}
									class:clamped-start={box.clampedStart}
									class:selected={selectedKey === key}
									style:left={`${box.left}px`}
									style:width={`${box.width}px`}
									style:top={`${rowTop(i) + (ROW_HEIGHT - BAR_HEIGHT) / 2}px`}
									style:height={`${BAR_HEIGHT}px`}
									style:--bar-h={`${BAR_HEIGHT}px`}
									style:--bar-color={barColor(row)}
									title={`${span.note ? span.note : "No description"} — ${formatDate(span.start)} → ${span.open ? "now" : formatDate(span.end)}`}
									onclick={() => selectSpan(row, span)}
									ondblclick={() => beginEditDesc(row, span)}
									oncontextmenu={(e) => openMenu(e, row, span)}
								>
									<!-- Left edge: drag to move this period's start date. -->
									{#if !box.clampedStart}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="gantt-handle left"
											onpointerdown={(e) => beginEdgeDrag(e, "start", row, span, history)}
											onclick={(e) => e.stopPropagation()}
											title="Drag to move the start date"
										></div>
									{/if}
									{#if editingKey === key}
										<!-- Fully inline: the input sits in the label's slot with no chrome
										     of its own, so editing reads as typing over the label text. -->
										<!-- svelte-ignore a11y_autofocus -->
										<input
											class="gantt-bar-edit"
											placeholder="No description"
											bind:value={editingText}
											autofocus
											onclick={(e) => e.stopPropagation()}
											onpointerdown={(e) => e.stopPropagation()}
											onblur={() => commitEditDesc(row, span)}
											onkeydown={(e) => {
												if (e.key === "Enter") { e.preventDefault(); commitEditDesc(row, span); }
												else if (e.key === "Escape") { e.preventDefault(); cancelEditDesc(); }
											}}
										/>
									{:else}
										<span class="gantt-bar-label" class:placeholder={!span.note}>
											{#if span.note}{span.note}{:else}No description{/if}
										</span>
									{/if}
									<!-- Right edge: drag to move the end date, or (open-ended) to set one.
									     A click-in-place here (no drag) on a bounded span reopens it. -->
									{#if !box.clampedEnd}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="gantt-handle right"
											onpointerdown={(e) => beginEdgeDrag(e, "end", row, span, history)}
											onclick={(e) => e.stopPropagation()}
											title={openEnded ? "Drag left to set an end date" : "Drag to move the end date · click to make indefinite"}
										></div>
									{/if}
								</div>
							{/if}
						{/if}
					{/each}
				{/each}

				<!-- Create-drag range preview: a ghost bar between anchor and pointer.
				     The gesture creates a bounded active period [a, b): active at `a`,
				     inactive at `b`. So the ghost's right edge lands on the `b` boundary
				     line (matching the committed bar and the drag marker), *not* b+1 —
				     otherwise the preview reads one day wider than what gets written. -->
				{#if drag && drag.kind === "create" && drag.moved}
					{@const a = drag.anchorDate <= drag.preview ? drag.anchorDate : drag.preview}
					{@const b = drag.anchorDate <= drag.preview ? drag.preview : drag.anchorDate}
					{@const ri = rows.findIndex((r) => r.key === drag!.row.key)}
					<div
						class="gantt-ghost"
						style:left={`${dateToX(a, viewport.start, pxPerDay)}px`}
						style:width={`${Math.max(3, dateToX(b, viewport.start, pxPerDay) - dateToX(a, viewport.start, pxPerDay))}px`}
						style:top={`${rowTop(ri) + (ROW_HEIGHT - BAR_HEIGHT) / 2}px`}
						style:height={`${BAR_HEIGHT}px`}
					></div>
				{/if}

				<!-- Drag boundary marker: the snapped day-boundary under the pointer. -->
				{#if drag}
					<div class="gantt-drag-marker" style:left={`${dateToX(drag.preview, viewport.start, pxPerDay)}px`} style:height={`${contentHeight}px`}>
						<span class="gantt-drag-date">{formatDate(drag.preview)}</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Precise date entry (from the menu): a calendar to pick a start or end date. -->
{#if dateEdit}
	<Portal>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="gantt-scrim" onclick={() => (dateEdit = null)}>
			<div class="gantt-card" onclick={(e) => e.stopPropagation()}>
				<div class="gantt-card-head">
					<span class="gantt-card-title">
						{dateEdit.row.label} — {dateEdit.which === "start" ? "start date" : "end date"}
					</span>
					<span class="gc-spacer"></span>
					<button class="gantt-x" aria-label="Close" onclick={() => (dateEdit = null)}>✕</button>
				</div>
				<div class="gantt-datepicker"><Datepicker inline bind:value={dateEditValue} onselect={commitDateEdit} /></div>
			</div>
		</div>
	</Portal>
{/if}

<style>
	.gantt-wrap {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}
	/* ── Header bar (mirrors Grid / Week view) — tinted background-secondary. ── */
	.gantt-header-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		flex-shrink: 0;
	}
	.gc-spacer { flex: 1; }

	.day-nav {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
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
	/* Give the inline SVG an explicit size so it doesn't collapse to 0-width inside
	   the flex button (renders as 0×14 = invisible otherwise). */
	.icon-btn svg {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}
	.nav-btn { height: 24px; width: 24px; }
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
	.day-date:hover { background: var(--background-modifier-hover); }
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
	.interval-tabs {
		display: flex;
		gap: 2px;
		background: var(--background-primary-alt);
		border: 1px solid var(--background-modifier-border);
		border-radius: 7px;
		padding: 2px;
	}
	.interval-tab {
		height: 22px;
		padding: 0 10px;
		font-size: 11px;
		font-weight: 500;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.interval-tab:hover { color: var(--text-normal); }
	.interval-tab.active {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}
	.gantt-empty {
		padding: 24px;
		color: var(--text-muted);
		text-align: center;
	}
	.gantt-grid {
		display: flex;
		flex: 1;
		overflow: auto;
		/* Match the Grid / Week body insets so the plot doesn't run flush to the view
		   edges. Sticky children (.gantt-labels) pin to this padding box's left edge. */
		padding: 0 10px 12px;
	}
	.gantt-labels {
		flex-shrink: 0;
		border-right: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		position: sticky;
		left: 0;
		z-index: 2;
	}
	.gantt-corner {
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}
	.gantt-label {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 8px 0 12px;
		font-size: 12px;
		color: var(--text-normal);
		overflow: visible;
	}
	.gantt-label.indent { padding-left: 26px; }
	/* Continuous group accent stripe, mirroring the Grid: rounded only at the
	   group's top/bottom, and extended through the row gap between grouped rows so
	   it reads as unbroken across the fixed-height, gapped Gantt rows. */
	.gantt-accent {
		position: absolute;
		left: 4px;
		top: 0;
		width: 3px;
		background: var(--row-accent, var(--text-faint));
	}
	.gantt-label.group-start .gantt-accent {
		border-top-left-radius: 2px;
		border-top-right-radius: 2px;
	}
	.gantt-label.group-end .gantt-accent {
		border-bottom-left-radius: 2px;
		border-bottom-right-radius: 2px;
	}
	.gantt-plot {
		position: relative;
		flex: 1;
		min-width: 400px;
	}
	/* Two-level header: a coarse grouping row stacked over a fine row. Tinted to
	   match the header bar / label column (background-secondary). */
	.gantt-header {
		position: sticky;
		top: 0;
		z-index: 1;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}
	.gantt-header-coarse {
		position: relative;
		width: 100%;
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.gantt-header-fine { position: absolute; left: 0; width: 100%; }
	/* Coarse row = secondary context → subdued (the fine row carries the primary
	   information and is emphasized instead). */
	.gantt-coarse-label {
		position: absolute;
		top: 3px;
		transform: translateX(-50%);
		font-size: 10px;
		font-weight: 400;
		color: var(--text-faint);
		white-space: nowrap;
		pointer-events: none;
	}
	/* A short separator tick at each coarse group's left boundary. */
	.gantt-coarse-sep {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 1px solid var(--background-modifier-border);
	}
	/* Fine row = primary information → emphasized. */
	.gantt-fine-label {
		position: absolute;
		top: 4px;
		transform: translateX(-50%);
		font-size: 10px;
		font-weight: 600;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		pointer-events: none;
	}
	/* The leftmost boundary tick has no room to center on the line, so left-align it. */
	.gantt-fine-label.edge {
		transform: translateX(2px);
	}
	.gantt-gridline {
		position: absolute;
		width: 0;
		border-left: 1px dashed var(--background-modifier-border);
	}
	/* Coarse-unit boundaries read heavier than the fine day/week lines. */
	.gantt-gridline.coarse {
		border-left: 1.5px solid var(--background-modifier-border);
	}
	.gantt-today {
		position: absolute;
		top: 0;
		width: 0;
		/* todayX is today's left boundary; nudge to sit on the line. */
		transform: translateX(-1px);
		border-left: 2px solid var(--color-red, #e5534b);
		opacity: 0.75;
		/* Above the bars (z-index 1) so the today reference line is never occluded. */
		z-index: 5;
		pointer-events: none;
	}
	/* Empty-row press target for authoring a new active period. Transparent, but
	   hints with a faint tint on hover so the row reads as "clickable canvas". */
	.gantt-create-zone {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 0;
		cursor: crosshair;
	}
	.gantt-create-zone:hover {
		background: color-mix(in srgb, var(--interactive-accent) 5%, transparent);
	}
	/* Live preview of a create-drag's range. */
	.gantt-ghost {
		position: absolute;
		border-radius: 5px;
		background: color-mix(in srgb, var(--interactive-accent) 28%, transparent);
		border: 1px dashed var(--interactive-accent);
		z-index: 4;
		pointer-events: none;
	}
	.gantt-bar {
		position: absolute;
		border-radius: 5px;
		cursor: pointer;
		display: flex;
		align-items: center;
		/* visible so the open-ended arrow cap (::after) isn't clipped; the inner
		   label does its own ellipsis clipping. */
		overflow: visible;
		z-index: 1;
		/* Colored sides, plain interior: thick accent caps on left/right, a hairline
		   accent top/bottom, and a background-primary body so the bar reads as a
		   framed span rather than a filled block. */
		border: 1px solid color-mix(in srgb, var(--bar-color) 45%, transparent);
		border-left: 3px solid var(--bar-color);
		border-right: 3px solid var(--bar-color);
		background: var(--background-primary);
	}
	.gantt-bar:hover {
		border-color: color-mix(in srgb, var(--bar-color) 70%, transparent);
		border-left-color: var(--bar-color);
		border-right-color: var(--bar-color);
	}
	/* Open-ended (still-running) spans: no right border, arrow cap → "continues". */
	.gantt-bar.open-ended {
		border-right: none;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.gantt-bar.open-ended::after {
		content: "";
		position: absolute;
		right: -8px;
		border-top: calc(var(--bar-h, 22px) / 2 + 1px) solid transparent;
		border-bottom: calc(var(--bar-h, 22px) / 2 + 1px) solid transparent;
		border-left: 8px solid var(--bar-color);
	}
	/* Span whose real start is off-screen left: square that edge (it's cut, not a boundary). */
	.gantt-bar.clamped-start {
		border-left: none;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	/* Selected (single-click): accent outline so the keyboard target is obvious. */
	.gantt-bar.selected {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
	}
	.gantt-bar-label {
		flex: 1;
		min-width: 0;
		font-size: 10px;
		padding: 0 6px 0 8px;
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}
	/* A bar with no note shows a muted "No description" placeholder. */
	.gantt-bar-label.placeholder {
		color: var(--text-faint);
		font-style: italic;
	}
	/* In-place description editor: occupies the label's slot with no chrome of its
	   own (same font, padding, transparent background) so editing reads as typing
	   directly over the label — the caret and text sit exactly where the label was. */
	.gantt-bar-edit {
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0 6px 0 8px;
		font-size: 10px;
		font-family: inherit;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text-normal);
		z-index: 3;
	}
	.gantt-bar-edit::placeholder {
		color: var(--text-faint);
		font-style: italic;
	}
	.gantt-handle {
		position: absolute;
		top: 0;
		width: 8px;
		height: 100%;
		cursor: ew-resize;
		z-index: 2;
	}
	.gantt-handle.left { left: 0; }
	.gantt-handle.right { right: 0; }
	.gantt-handle:hover { background: color-mix(in srgb, var(--bar-color) 45%, transparent); }
	/* The open-ended arrow cap doubles as the right handle's visual affordance. */
	.gantt-bar.open-ended .gantt-handle.right { right: -8px; width: 16px; }
	.gantt-drag-marker {
		position: absolute;
		top: 0;
		width: 2px;
		background: var(--interactive-accent);
		z-index: 3;
		pointer-events: none;
	}
	.gantt-drag-date {
		position: absolute;
		top: 2px;
		left: 4px;
		font-size: 10px;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		padding: 1px 4px;
		border-radius: 3px;
		white-space: nowrap;
	}
	/* ── Edit popup ── */
	.gantt-scrim {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 40;
	}
	.gantt-card {
		width: min(360px, 90vw);
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 10px;
		padding: 14px;
		box-shadow: var(--shadow-l);
	}
	.gantt-card-head { display: flex; align-items: center; margin-bottom: 10px; }
	.gantt-card-title { font-weight: 600; }
	.gantt-x { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; }
	.gantt-datepicker { margin-top: 8px; }
</style>
