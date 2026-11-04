<script lang="ts">
	// The Gantt / strength view — "the old season view reborn". A retrospective
	// visualization of active spans, each with its intention and 0–5 intensity,
	// computed entirely from the history arrays (no stored spans). It is also the
	// primary editing surface: dragging a span boundary moves the date of the
	// record that begins the later span, and clicking a span opens a popup to edit
	// its intention/intensity — both routing through the same guarded edit functions the
	// Projects page uses (projectActions → index → projectFile invariants).
	//
	// Rows mirror the Projects page grouping: each domain, its child projects
	// nested beneath, then unassigned (orphan) projects. Same data as the Projects
	// page — different question (retrospective spans vs. present snapshot). Which
	// of them earn a row depends on the viewport, not on today alone (gantt/rows).

	import { onMount, tick } from "svelte";
	import { Menu } from "obsidian";
	import type { App } from "obsidian";
	import type { Unsubscriber } from "svelte/store";
	import type { Domain, ISODate, LifecycleState, Project, StatusRecord } from "../../types";
	import type { KairosIndex, ProjectsDomains } from "../../index";
	import { dateFromISO, isoFromDate, todayISO } from "../../dayNote";
	import {
		editDomainStatusRecord,
		editProjectStatusRecord,
		setDomainActivePeriod,
		setDomainHistory,
		setDomainStatus,
		setProjectActivePeriod,
		setProjectHistory,
		setProjectStatus,
	} from "../../projectActions";
	import {
		BAR_HEIGHT,
		BAR_OFFSET,
		HEADER_COARSE_HEIGHT,
		HEADER_FINE_HEIGHT,
		HEADER_HEIGHT,
		INTERVALS,
		INTERVAL_LABEL,
		LABEL_PAD_Y,
		ROW_GAP,
		ROW_HEIGHT,
		rowHeightFor,
		rowTops,
		dateToX,
		getHeader,
		daysBetween,
		dragBounds,
		dragPeriod,
		shiftDays,
		stepView,
		SUB_UNIT,
		unitRange,
		viewLabel,
		viewRange,
		xToDate,
		xToDay,
		type Interval,
	} from "../../gantt/ganttUtils";
	import { historyToSpans, type Span } from "../../gantt/spans";
	import {
		applyStretchEdit,
		archiveStop,
		canRemoveEnd,
		canSplitAt,
		clampStretchEdit,
		deleteStretch,
		mergeableNext,
		mergeWithNext,
		removeEnd,
		splitStretch,
		type StretchEditKind,
	} from "../../gantt/stretchEdits";
	import { addIntensityItem } from "./intensityMenu";
	import { visibleEntities } from "../../gantt/rows";
	import Datepicker from "../components/Datepicker.svelte";
	import StepArrows from "../components/StepArrows.svelte";
	import Portal from "../components/Portal.svelte";
	import { addRollupItem } from "../projects/projectMenu";
	import RowLabel from "../components/RowLabel.svelte";
	import IconButton from "../components/IconButton.svelte";
	import IntensityBars from "../components/IntensityBars.svelte";
	import { peek } from "../actions/peek";
	import { intoViewHeader } from "../actions/viewHeader";
	import { rowLabelInfo, type RowLabelInfo } from "../components/rowLabel";

	interface Props {
		app: App;
		index: KairosIndex;
		// The leaf's tab header, which the header bar moves into.
		viewHeader?: HTMLElement;
	}
	let { index, viewHeader }: Props = $props();

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
	// `interval` picks the granularity (week/month/quarter/year) and the range is
	// one unit of it long, starting at `start`. It opens on a whole unit; the
	// big arrows move it a whole unit and the small arrows one unit down, which
	// can leave it mid-unit (8 Oct – 7 Nov). "Today", the calendar and a change
	// of interval snap it back to the whole unit around a date (ganttUtils).
	const INITIAL_INTERVAL: Interval = "month";
	let interval = $state<Interval>(INITIAL_INTERVAL);
	let start = $state<ISODate>(unitRange(INITIAL_INTERVAL, todayISO()).start);
	// The date a change of interval keeps in view: today, or the day last
	// picked in the calendar, while it's still on screen.
	let focus = $state<ISODate>(todayISO());
	const viewport = $derived(viewRange(interval, start));
	// Number of whole days the range spans (drives px-per-day).
	const unitDays = $derived(daysBetween(viewport.start, viewport.end) + 1);
	const atToday = $derived(
		today >= viewport.start && today <= viewport.end,
	);
	// "Today" shows until the range is the whole unit around today again.
	const atHome = $derived(start === unitRange(interval, today).start);

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

	// Right-click a project's label: the Grid's rollup toggle (#11).
	function openLabelMenu(e: MouseEvent, row: GanttRow) {
		if (row.isDomain) return;
		const project = row.entity as Project;
		if (!project.domain) return;
		e.preventDefault();
		const menu = new Menu();
		addRollupItem(menu, index, project);
		menu.showAtMouseEvent(e);
	}

	function pan(dir: 1 | -1, big: boolean) {
		const next = stepView(interval, start, dir, big);
		void slidePlot(daysBetween(start, next));
		start = next;
	}
	function jumpToday() {
		focus = today;
		start = unitRange(interval, today).start;
	}
	function setInterval(next: Interval) {
		// Keep the same date in view when changing granularity: the one picked
		// (or today) if it's on screen, otherwise the range's first day.
		const keep = focus >= viewport.start && focus <= viewport.end ? focus : viewport.start;
		interval = next;
		start = unitRange(next, keep).start;
	}

	// A step slides the plot from where it was to where it lands, so the eye can
	// follow which way it went and how far; nothing re-centres. Each child of the
	// plot starts drawn at its old place (shifted by the step) and eases to its
	// new one. A jump (Today, the calendar, a new interval) just redraws.
	// While it slides, `clip` keeps the shifted children inside the plot's own
	// width without making it a scroll container, so the sticky header holds.
	const SLIDE_MS = 200;
	let slideTimer: number | undefined;
	async function slidePlot(days: number) {
		const el = plotEl;
		if (!el || days === 0 || pxPerDay <= 0) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		window.clearTimeout(slideTimer);
		el.setCssProps({
			"--gantt-slide-clip": "clip",
			"--gantt-slide-time": "0s",
			"--gantt-slide": `${days * pxPerDay}px`,
		});
		await tick();
		void el.offsetWidth; // commit the shifted start before easing out of it
		el.setCssProps({ "--gantt-slide-time": `${SLIDE_MS}ms`, "--gantt-slide": "0px" });
		slideTimer = window.setTimeout(() => {
			el.setCssProps({ "--gantt-slide-clip": "", "--gantt-slide-time": "", "--gantt-slide": "" });
		}, SLIDE_MS + 50);
	}

	// ── Header calendar (pick the unit to jump to) ──
	// The user picks any day; we snap to the unit of the current interval that
	// contains it (there is no precise per-day navigation at this altitude).
	let showCalendar = $state(false);
	let calendarValue = $state<Date>(dateFromISO(todayISO()));
	let dateNavRef = $state<HTMLDivElement>();
	function onCalendarSelect(picked: Date) {
		focus = isoFromDate(picked);
		start = unitRange(interval, focus).start;
		showCalendar = false;
	}
	function handleClickOutside(event: MouseEvent) {
		if (showCalendar && dateNavRef && !dateNavRef.contains(event.target as Node)) {
			showCalendar = false;
		}
	}

	// Each label's measured height, by row key. A row grows past ROW_HEIGHT when
	// its label needs it (a two-line note), and the plot follows the label column.
	let labelHeights = $state<Record<string, number>>({});
	const rowHeights = $derived(rows.map((r) => rowHeightFor(labelHeights[r.key])));
	const tops = $derived(rowTops(rowHeights, HEADER_HEIGHT));
	const rowTop = (i: number) => tops[i] ?? HEADER_HEIGHT;
	const rowHeight = (i: number) => rowHeights[i] ?? ROW_HEIGHT;
	const barTop = (i: number) => rowTop(i) + BAR_OFFSET;
	const contentHeight = $derived(
		rows.length === 0 ? HEADER_HEIGHT + ROW_GAP : rowTop(rows.length - 1) + rowHeight(rows.length - 1) + 2 * ROW_GAP,
	);

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
	//  • "move"   — a bar's body. Pressing selects it; dragging slides the whole
	//               stretch, keeping its length, and stops when it touches a
	//               neighbour. A press only counts as a drag once the pointer has
	//               travelled MOVE_SLOP pixels, so a click just selects.
	//  • "start" / "end" — a bar's edge. Resizes that bar alone: growing into a
	//               neighbour trims it (never below a day), shrinking away from one
	//               opens a gap. An open-ended bar's end drag gives it an end.
	//  • "create" — empty space in a row. A click-in-place adds one open-ended
	//               `active` record at that date; a click-drag adds a bounded active
	//               period covering every day column it crossed: an `active` on the
	//               first and an `inactive` on the day after the last (`dragPeriod`).
	//
	// The bar edits are pure history rewrites (gantt/stretchEdits), written in one
	// entity replacement. While a drag is live the row draws the rewritten history,
	// so a trimmed neighbour shrinks under the pointer before anything is written.
	// A date snaps to whole days (`xToDate`).
	type DragKind = StretchEditKind | "create";
	interface Drag {
		kind: DragKind;
		row: GanttRow;
		history: StatusRecord[]; // the row's history at press time
		spanStart: ISODate; // the stretch being edited (move/start/end)
		anchorDate: ISODate; // press date (create) / the date being changed (move/start/end)
		pressX: number; // pointer x at press, for the move slop and offset
		pointerId: number;
		lowerDate: ISODate | null; // create: exclusive lower clamp (record before)
		upperDate: ISODate | null; // create: exclusive upper clamp (record after)
		preview: ISODate; // current snapped date under the pointer
		moved: boolean; // a drag, not a click
		stoppedAt: ISODate | null; // the archive date holding a bar drag back, if any
	}
	const MOVE_SLOP = 4;
	let drag = $state<Drag | null>(null);
	let plotEl = $state<HTMLDivElement>();

	// The rewritten history a live bar drag would write, for the dragged row only.
	const dragHistory = $derived.by(() => {
		if (!drag || drag.kind === "create" || !drag.moved) return null;
		return {
			key: drag.row.key,
			history: applyStretchEdit(drag.history, drag.spanStart, drag.kind, drag.preview, today),
		};
	});
	// The cursor a bar drag holds across the plot (unset otherwise).
	const dragCursor = $derived(
		drag?.kind === "move" && drag.moved ? "grabbing"
			: drag?.kind === "start" || drag?.kind === "end" ? "ew-resize"
			: undefined,
	);
	function historyFor(row: GanttRow): StatusRecord[] {
		return dragHistory?.key === row.key ? dragHistory.history : row.entity.history;
	}

	// A note for a newly-created active record that is guaranteed *not* to collapse
	// against the active record in effect immediately before `start`. When the click
	// lands inside an existing active span (same status), an identical record would
	// be dropped as a no-op transition, so we seed a placeholder intention that
	// differs from the predecessor's, for the user to rename. Empty history /
	// non-active predecessor → no note needed.
	const NEW_INTENTION = "New intention";
	function boundaryNote(history: StatusRecord[], start: ISODate): string | undefined {
		let prev: StatusRecord | undefined;
		for (const r of history) {
			if (r.date < start) prev = r;
			else break;
		}
		if (!prev || prev.status !== "active") return undefined; // won't collapse
		return (prev.note ?? "").trim() === NEW_INTENTION ? undefined : NEW_INTENTION;
	}

	function pointerX(e: MouseEvent): number {
		const rect = plotEl?.getBoundingClientRect();
		return rect ? e.clientX - rect.left : e.clientX;
	}
	// Edge drags snap to the nearest day *boundary* (round); create/click resolves
	// the day *column* under the cursor (floor) so the picked date is the one the
	// pointer is visibly over, not whichever boundary happens to be closer.
	function pointerDate(e: MouseEvent): ISODate {
		return xToDate(pointerX(e), viewport.start, pxPerDay);
	}
	function pointerDay(e: MouseEvent): ISODate {
		return xToDay(pointerX(e), viewport.start, pxPerDay);
	}

	function clamp(date: ISODate, lower: ISODate | null, upper: ISODate | null): ISODate {
		let d = date;
		if (lower && d <= lower) d = shiftDays(lower, 1);
		if (upper && d >= upper) d = shiftDays(upper, -1);
		return d;
	}

	// The date a bar gesture changes, as it stands: the stretch's start for a
	// move or start edge, its exclusive end for an end edge (an open bar draws
	// through today, so its end edge sits on the day after).
	function editedDate(span: Span, kind: StretchEditKind): ISODate {
		if (kind !== "end") return span.start;
		return span.open ? shiftDays(span.end, 1) : span.end;
	}

	/** Press on a bar's body (move) or edge (start/end). Selects the bar too. */
	function beginBarDrag(e: PointerEvent, kind: StretchEditKind, row: GanttRow, span: Span) {
		if (e.button !== 0 || editingKey) return;
		e.stopPropagation();
		e.preventDefault();
		select(row, span);
		const anchorDate = editedDate(span, kind);
		drag = {
			kind,
			row,
			history: row.entity.history,
			spanStart: span.start,
			anchorDate,
			pressX: pointerX(e),
			pointerId: e.pointerId,
			lowerDate: null,
			upperDate: null,
			preview: anchorDate,
			moved: false,
			stoppedAt: null,
		};
		// Capture on the plot (stable across re-renders), not the pressed child —
		// child bars/zones re-render mid-drag, which would drop a child capture and
		// silently end the gesture. A body press waits until it's a drag: captured,
		// its click and double-click would land on the plot, not the bar.
		if (kind !== "move") plotEl?.setPointerCapture?.(e.pointerId);
	}

	/** Press on empty row space: create a new active period. */
	function beginCreateDrag(e: PointerEvent, row: GanttRow) {
		if (pxPerDay <= 0 || e.button !== 0) return;
		// Pressing empty canvas clears any bar selection.
		selectedKey = null;
		// On touch a press here is how a scroll starts, and a stray tap would
		// write a stretch: touch adds one from the row label's ⋯ instead
		// (spec decision 137).
		if (e.pointerType !== "mouse") return;
		e.preventDefault();
		const history = row.entity.history;
		const date = pointerDay(e);
		// Clamp to the gaps between existing records so a create can't collide.
		const { lower, upper } = dragBounds(history, date);
		drag = {
			kind: "create",
			row,
			history,
			spanStart: date,
			anchorDate: date,
			pressX: pointerX(e),
			pointerId: e.pointerId,
			lowerDate: lower,
			upperDate: upper,
			preview: date,
			moved: false,
			stoppedAt: null,
		};
		plotEl?.setPointerCapture?.(e.pointerId);
	}

	function moveDrag(e: PointerEvent) {
		if (!drag || pxPerDay <= 0) return;
		const d = drag;
		if (d.kind === "create") {
			const next = clamp(pointerDay(e), d.lowerDate, d.upperDate);
			drag = { ...d, preview: next, moved: d.moved || next !== d.anchorDate };
			return;
		}
		const dx = pointerX(e) - d.pressX;
		if (!d.moved && Math.abs(dx) < MOVE_SLOP) return;
		if (!d.moved) plotEl?.setPointerCapture?.(d.pointerId);
		// A move keeps the grab offset; an edge follows the nearest day boundary.
		const raw = d.kind === "move"
			? shiftDays(d.spanStart, Math.round(dx / pxPerDay))
			: pointerDate(e);
		const next = clampStretchEdit(d.history, d.spanStart, d.kind, raw, today);
		const stoppedAt = archiveStop(d.history, d.spanStart, d.kind, raw, today);
		drag = { ...d, preview: next, moved: true, stoppedAt };
	}

	function endDrag() {
		if (!drag) return;
		const d = drag;
		drag = null;
		const isDomain = d.row.isDomain;
		const domain = d.row.entity as Domain;
		const project = d.row.entity as Project;

		if (d.kind === "create") {
			const { start, end } = dragPeriod(d.anchorDate, d.preview);
			// If the new active record would sit right after another active one with an
			// identical note, `normalizeHistory` collapses it (a no-op transition) and
			// nothing is written. Seed a distinguishing note for the user to rename.
			const note = boundaryNote(d.row.entity.history, start);
			if (!d.moved || d.preview === d.anchorDate) {
				// Click → open-ended active.
				if (isDomain) setDomainStatus(index, domain, start, "active", note);
				else setProjectStatus(index, project, start, "active", note);
			} else if (isDomain) {
				setDomainActivePeriod(index, domain, start, end, note);
			} else {
				setProjectActivePeriod(index, project, start, end, note);
			}
			return;
		}

		// A press without a drag only selected the bar.
		if (!d.moved || d.preview === d.anchorDate) return;
		editStretch(d.row, d.spanStart, d.kind, d.preview);
	}

	// The browser took the pointer: a touch that turned into a scroll, or a system
	// gesture. Drop the drag without writing. pointercancel comes before the
	// pointerleave that follows it, so endDrag then finds nothing to commit;
	// before, that pointerleave saved a create or an edit nobody meant.
	function cancelDrag() {
		drag = null;
	}

	// Apply a bar edit to the live row and keep the bar selected under its new start.
	function editStretch(row: GanttRow, start: ISODate, kind: StretchEditKind, to: ISODate) {
		const live = currentRow(row.key);
		if (!live) return;
		const next = applyStretchEdit(live.entity.history, start, kind, to, today);
		writeHistory(live, next);
		if (kind !== "end" && selectedKey === spanKey(row.key, start)) {
			selectedKey = spanKey(row.key, clampStretchEdit(live.entity.history, start, kind, to, today));
		}
	}
	function writeHistory(live: GanttRow, history: StatusRecord[]) {
		if (live.isDomain) setDomainHistory(index, live.entity as Domain, history);
		else setProjectHistory(index, live.entity, history);
	}

	// ── Bar interaction model ───────────────────────────────────────────────────
	// A bar is always active, so there's no status to pick. The fast-path gestures
	// (drag to move or resize, click empty space to create, arrow keys to nudge,
	// Delete to remove, double-click to rename) cover the common edits; the
	// right-click menu is the home for precise control (calendar date entry,
	// split, merge, removing an end).
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

	// ── Selection (press) ──
	// The selected span, so the keys act on it, it draws an outline and its edge
	// handles stand outside its ends. Cleared on Escape or a press on empty plot
	// space.
	let selectedKey = $state<string | null>(null);
	// While a bar is dragged its start may move; the outline follows it.
	const shownSelectedKey = $derived(
		drag && drag.kind !== "create" && drag.kind !== "end" && drag.moved
			&& selectedKey === spanKey(drag.row.key, drag.spanStart)
			? spanKey(drag.row.key, drag.preview)
			: selectedKey,
	);
	function select(row: GanttRow, span: Span) {
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

	// Delete removes the selected period; 0–5 sets its intensity; ←/→ move it a
	// day, Shift moves its end and Alt its start; Escape clears selection (and
	// closes an in-place edit first). Ignored while typing in the intention input.
	function onPlotKeyDown(e: KeyboardEvent) {
		const t = e.target;
		if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.isContentEditable)) return;
		const key = e.key;
		if (key === "Delete" || key === "Backspace") {
			const target = selectedTarget();
			if (!target) return;
			e.preventDefault();
			deletePeriod(target.row, target.span);
		} else if (/^[0-5]$/.test(key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
			const target = selectedTarget();
			if (!target) return;
			e.preventDefault();
			setIntensity(target.row, target.span, Number(key));
		} else if ((key === "ArrowLeft" || key === "ArrowRight") && !e.metaKey && !e.ctrlKey) {
			const target = selectedTarget();
			if (!target || (e.shiftKey && e.altKey)) return;
			e.preventDefault();
			const kind: StretchEditKind = e.shiftKey ? "end" : e.altKey ? "start" : "move";
			// An open bar has no end to nudge later; Shift+← gives it one.
			if (kind === "end" && target.span.open && key === "ArrowRight") return;
			const from = editedDate(target.span, kind);
			editStretch(target.row, target.span.start, kind, shiftDays(from, key === "ArrowLeft" ? -1 : 1));
		} else if (key === "Escape") {
			if (editingKey) { cancelEditDesc(); return; }
			selectedKey = null;
		}
	}

	// ── Intensity (0–5) ──
	// Written onto the span's opening record through the same guarded edit as the
	// intention; `undefined` clears it back to "no claim". Set from the bar's intensity bars,
	// the number keys on a selected bar, or the context menu.
	function setIntensity(row: GanttRow, span: Span, value: number | undefined) {
		const live = currentRow(row.key);
		if (!live) return;
		const next = {
			date: span.start,
			status: "active" as LifecycleState,
			note: span.note ?? "",
			intensity: value,
		};
		if (live.isDomain) editDomainStatusRecord(index, live.entity as Domain, span.start, next);
		else editProjectStatusRecord(index, live.entity, span.start, next);
	}
	// The bar's fill, as a share of the project colour: 10% a level, so 5 is 50%
	// and the label stays readable over it. 0 and unset fill nothing.
	function fillPercent(span: Span): number {
		return (span.intensity ?? 0) * 10;
	}

	// ── In-place intention editing (double-click) ──
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
		else editProjectStatusRecord(index, live.entity, span.start, next);
	}
	function cancelEditDesc() {
		editingKey = null;
	}

	// ── Whole-stretch edits from the menu and keys ──
	// Each rewrites the live row's history in one write (gantt/stretchEdits).
	// Delete leaves the stretch's days inactive without touching its neighbours.
	function deletePeriod(row: GanttRow, span: Span) {
		const live = currentRow(row.key);
		if (!live) return;
		if (selectedKey === spanKey(row.key, span.start)) selectedKey = null;
		writeHistory(live, deleteStretch(live.entity.history, span.start));
	}
	// Drop a gap closer so the stretch runs on (open-ended when it was the last).
	function reopenSpan(row: GanttRow, span: Span) {
		const live = currentRow(row.key);
		if (live) writeHistory(live, removeEnd(live.entity.history, span.start));
	}
	// The second half gets a placeholder intention distinct from the first's, so
	// the two halves don't collapse back into one.
	function splitAt(row: GanttRow, span: Span, at: ISODate) {
		const live = currentRow(row.key);
		if (!live) return;
		const note = (span.note ?? "").trim() === NEW_INTENTION ? `${NEW_INTENTION} 2` : NEW_INTENTION;
		writeHistory(live, splitStretch(live.entity.history, span.start, at, note));
	}
	function mergeNext(row: GanttRow, span: Span) {
		const live = currentRow(row.key);
		if (live) writeHistory(live, mergeWithNext(live.entity.history, span.start));
	}

	// ── Right-click context menu (precise control) ──
	// A native Obsidian Menu (matching TimelineBlock / ProjectsView) shown at the
	// pointer. Items differ by span kind: an open span's "Set end date" is what
	// makes it definite; a span ending in a gap can have its end removed. Split
	// works on the day column under the pointer.
	// Touch's row menu (the row label's ⋯): a press on empty row space makes no
	// stretch on touch, so this is where one starts (spec decision 137).
	function openRowMenu(e: MouseEvent, row: GanttRow) {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle("Add a stretch from today").setIcon("plus").onClick(() => addStretchToday(row)),
		);
		menu.showAtMouseEvent(e);
	}
	function addStretchToday(row: GanttRow) {
		const live = currentRow(row.key);
		if (!live) return;
		const start = todayISO();
		const note = boundaryNote(live.entity.history, start);
		if (live.isDomain) setDomainStatus(index, live.entity as Domain, start, "active", note);
		else setProjectStatus(index, live.entity, start, "active", note);
	}

	function openMenu(e: MouseEvent, row: GanttRow, span: Span) {
		e.preventDefault();
		e.stopPropagation();
		selectedKey = spanKey(row.key, span.start);
		const history = row.entity.history;
		const at = pointerDay(e);
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle("Edit intention").setIcon("pencil").onClick(() => beginEditDesc(row, span)),
		);
		addIntensityItem(menu, span.intensity, (level) => setIntensity(row, span, level));
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
		}
		if (canRemoveEnd(history, span.start)) {
			menu.addItem((item) =>
				item.setTitle("Remove end date").setIcon("infinity").onClick(() => reopenSpan(row, span)),
			);
		}
		menu.addSeparator();
		if (canSplitAt(history, span.start, at)) {
			menu.addItem((item) =>
				item.setTitle(`Split on ${formatDate(at)}`).setIcon("scissors").onClick(() => splitAt(row, span, at)),
			);
		}
		if (mergeableNext(history, span.start)) {
			menu.addItem((item) =>
				item.setTitle("Merge with next").setIcon("merge").onClick(() => mergeNext(row, span)),
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
		// A bounded span's `end` is its closer's date; an open one's is today.
		dateEdit = { row, span, which };
		dateEditValue = dateFromISO(which === "start" ? span.start : span.end);
	}
	function commitDateEdit(picked: Date) {
		const d = dateEdit;
		dateEdit = null;
		if (!d) return;
		const live = currentRow(d.row.key);
		if (!live) return;
		// The same rules as a drag: it trims a neighbour it grows into, clamped.
		editStretch(live, d.span.start, d.which, isoFromDate(picked));
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
	<div class="gantt-header-bar" use:intoViewHeader={viewHeader}>
		<div class="day-nav" bind:this={dateNavRef}>
			<StepArrows big={`a ${interval}`} small={`a ${SUB_UNIT[interval]}`} onstep={pan}>
				<button
					class="day-date"
					title="Click to jump to a {INTERVAL_LABEL[interval].toLowerCase()}"
					onclick={(e) => { e.stopPropagation(); showCalendar = !showCalendar; }}
				>
					{viewLabel(interval, start)}
				</button>
			</StepArrows>

			{#if !atHome}
				<button class="today-btn" onclick={(e) => { e.stopPropagation(); jumpToday(); }}>Today</button>
			{/if}

			{#if showCalendar}
				<div class="calendar-popup">
					<Datepicker inline bind:value={calendarValue} onselect={onCalendarSelect} />
				</div>
			{/if}
		</div>

		<span class="gc-spacer"></span>

		<!-- On a narrow screen the four tabs don't fit beside the date, so they
		     become one dropdown (a phone shows its own picker for it). -->
		<select
			class="dropdown interval-select"
			aria-label="Interval"
			value={interval}
			onchange={(e) => setInterval(e.currentTarget.value as Interval)}
			onclick={(e) => e.stopPropagation()}
		>
			{#each INTERVALS as iv}
				<option value={iv}>{INTERVAL_LABEL[iv]}</option>
			{/each}
		</select>
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
			<div
				class="gantt-labels"
				style:--label-pad-y={`${LABEL_PAD_Y}px`}
				style:--row-gap={`${ROW_GAP}px`}
			>
				<div class="gantt-corner" style:height={`${HEADER_HEIGHT}px`}></div>
				{#each rows as row, i (row.key)}
					{@const group = ganttGroup(i)}
					<div
						class="gantt-label"
						class:indent={row.indent}
						class:domain={row.isDomain}
						class:group-start={group.start}
						class:group-end={group.end}
						class:alt={i % 2 === 1}
						style:height={`${rowHeight(i)}px`}
						style:margin-bottom={`${ROW_GAP}px`}
						style={row.color ? `--row-accent: ${row.color};` : undefined}
						oncontextmenu={(e) => openLabelMenu(e, row)}
					>
						<!-- The accent runs through the row gap, so the stripe is unbroken
						     down the column like the Grid's left border. -->
						<span class="gantt-accent" style:height={`${rowHeight(i) + ROW_GAP}px`}></span>
						<div class="gantt-label-body" bind:offsetHeight={labelHeights[row.key]}>
							<RowLabel info={row.info} />
						</div>
						<!-- Touch only (pointer: coarse): the row's menu. -->
						<span class="gantt-touch-more">
							<IconButton label="Row actions" icon="more-horizontal" onclick={(e: MouseEvent) => openRowMenu(e, row)} />
						</span>
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
				style:--drag-cursor={dragCursor}
				onpointermove={moveDrag}
				onpointerup={endDrag}
				onpointerleave={endDrag}
				onpointercancel={cancelDrag}
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

				<!-- Every other row is tinted, level with its label, as in the Grid. -->
				{#each rows as row, i (row.key)}
					{#if i % 2 === 1}
						<div
							class="gantt-row-alt"
							style:top={`${rowTop(i)}px`}
							style:height={`${rowHeight(i)}px`}
						></div>
					{/if}
				{/each}

				<!-- The line under each group, level with the label column's. -->
				{#each rows as row, i (row.key)}
					{#if ganttGroup(i).end}
						<div
							class="gantt-group-line"
							style:top={`${rowTop(i) + rowHeight(i) + ROW_GAP - 1}px`}
						></div>
					{/if}
				{/each}

				<!-- Create zones: empty row space; press here to author a new active
				     period (click = open-ended, drag = bounded). Sits behind the bars. -->
				{#each rows as row, i (row.key)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="gantt-create-zone"
						style:top={`${rowTop(i)}px`}
						style:height={`${rowHeight(i)}px`}
						title="Drag to add an active period · click to start one"
						onpointerdown={(e) => beginCreateDrag(e, row)}
					></div>
				{/each}

				<!-- Active bars only — inactivity is the absence of a bar. -->
				{#each rows as row, i (row.key)}
					{@const spans = historyToSpans(historyFor(row), today)}
					{#each spans as span (span.start)}
						{#if span.status === "active"}
							{@const box = spanBox(span)}
							{#if box}
								{@const openEnded = span.open && !box.clampedEnd}
								{@const key = spanKey(row.key, span.start)}
								{@const selected = shownSelectedKey === key}
								<!-- How far each edge's hit zone reaches into the body: a
								     quarter of a thin bar, so the middle still moves it. -->
								{@const handleIn = Math.min(6, Math.max(1, Math.floor(box.width / 4)))}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="gantt-bar"
									class:open-ended={openEnded}
									class:clamped-start={box.clampedStart}
									class:selected
									class:dormant={span.intensity === 0}
									class:unrated={span.intensity === undefined}
									style:--fill={`${fillPercent(span)}%`}
									style:left={`${box.left}px`}
									style:width={`${box.width}px`}
									style:top={`${barTop(i)}px`}
									style:height={`${BAR_HEIGHT}px`}
									style:--bar-h={`${BAR_HEIGHT}px`}
									style:--bar-color={barColor(row)}
									style:--handle-in={`${handleIn}px`}
									use:peek={{
										text: span.note || "No intention",
										detail: `${formatDate(span.start)} → ${span.open ? "now" : formatDate(span.end)}`,
										always: true,
									}}
									onpointerdown={(e) => beginBarDrag(e, "move", row, span)}
									ondblclick={() => beginEditDesc(row, span)}
									oncontextmenu={(e) => openMenu(e, row, span)}
								>
									<!-- Left edge: drag to move this period's start date. -->
									{#if !box.clampedStart}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="gantt-handle left"
											onpointerdown={(e) => beginBarDrag(e, "start", row, span)}
										></div>
									{/if}
									<!-- Intensity bars: three stacked, two levels a bar. Hidden on an
									     unrated bar until hover, so they double as the way to rate it;
									     dropped on a bar too narrow to hold them beside a label. -->
									{#if box.width >= 40}
										<span class="gantt-pips">
											<IntensityBars level={span.intensity} onpick={(level: number | undefined) => setIntensity(row, span, level)} />
										</span>
									{/if}
									{#if editingKey === key}
										<!-- Fully inline: the input sits in the label's slot with no chrome
										     of its own, so editing reads as typing over the label text. -->
										<!-- svelte-ignore a11y_autofocus -->
										<input
											class="gantt-bar-edit kairos-inline-input"
											placeholder="No intention"
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
											{#if span.note}{span.note}{:else}No intention{/if}
										</span>
									{/if}
									<!-- Touch only (pointer: coarse): a selected bar's menu, where
									     right-click and double-click can't reach. -->
									{#if selected}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<span class="gantt-touch-more gantt-bar-more" onpointerdown={(e) => e.stopPropagation()}>
											<IconButton label="More actions" icon="more-horizontal" onclick={(e: MouseEvent) => openMenu(e, row, span)} />
										</span>
									{/if}
									<!-- Right edge: drag to move the end date, or (open-ended) to set one. -->
									{#if !box.clampedEnd}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="gantt-handle right"
											onpointerdown={(e) => beginBarDrag(e, "end", row, span)}
										></div>
									{/if}
								</div>
							{/if}
						{/if}
					{/each}
				{/each}

				<!-- Create-drag range preview: a ghost bar over every day column between
				     the pressed one and the one under the pointer, both included. It
				     covers exactly the period the release writes (`dragPeriod`): active
				     at `a`, inactive at `b`, the day after the last column. -->
				{#if drag && drag.kind === "create" && drag.moved}
					{@const { start: a, end: b } = dragPeriod(drag.anchorDate, drag.preview)}
					{@const ri = rows.findIndex((r) => r.key === drag!.row.key)}
					<div
						class="gantt-ghost"
						style:left={`${dateToX(a, viewport.start, pxPerDay)}px`}
						style:width={`${Math.max(3, dateToX(b, viewport.start, pxPerDay) - dateToX(a, viewport.start, pxPerDay))}px`}
						style:top={`${barTop(ri)}px`}
						style:height={`${BAR_HEIGHT}px`}
					></div>
				{/if}

				<!-- Drag boundary marker: the snapped day-boundary under the pointer. A
				     create-drag marks the ghost's edge on the pointer's side instead, so
				     a rightward drag's marker sits after the column it's over. When an
				     archive record holds the bar back, a line marks the archive date and
				     the label says why the bar stopped short of the pointer. It shows
				     only while dragging, so it reads the same under a finger. -->
				{#if drag?.stoppedAt}
					<div class="gantt-archive-stop" style:left={`${dateToX(drag.stoppedAt, viewport.start, pxPerDay)}px`} style:height={`${contentHeight}px`}></div>
				{/if}
				{#if drag}
					{@const markerDate = drag.kind === "create" && drag.preview > drag.anchorDate
						? shiftDays(drag.preview, 1)
						: drag.preview}
					<div class="gantt-drag-marker" style:left={`${dateToX(markerDate, viewport.start, pxPerDay)}px`} style:height={`${contentHeight}px`}>
						<span class="gantt-drag-date">{formatDate(drag.preview)}{#if drag.stoppedAt} · Stops at archive date{/if}</span>
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
	.interval-select {
		display: none;
	}
	/* Outranks `.interval-tabs`' own display, which comes later in the file. */
	@media (max-width: 600px) {
		.gantt-header-bar .interval-tabs {
			display: none;
		}
		.gantt-header-bar .interval-select {
			display: block;
		}
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
		width: var(--kairos-row-label-width);
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
	/* Insets and indent are the Grid's (--kairos-row-label-* in styles.css), so
	   the two label columns read as one. Like the Grid, the label sits at the
	   top of its row; the bar lines up with its first line (BAR_OFFSET). */
	.gantt-label {
		position: relative;
		display: flex;
		align-items: flex-start;
		padding: var(--label-pad-y) var(--kairos-row-label-pad-right) 0
			calc(var(--kairos-row-label-accent-width) + var(--kairos-row-label-pad-left));
		overflow: visible;
	}
	.gantt-label.indent {
		padding-left: calc(
			var(--kairos-row-label-accent-width) + var(--kairos-row-label-pad-left) + var(--kairos-row-label-indent)
		);
	}
	.gantt-label-body {
		flex: 1;
		min-width: 0;
	}
	/* The group accent stripe, square like the Grid's left border. */
	.gantt-accent {
		position: absolute;
		left: 0;
		top: 0;
		width: var(--kairos-row-label-accent-width);
		background: var(--row-accent, var(--text-faint));
	}
	/* A line under each group, at the foot of the row gap, like the Grid's
	   border under a group's last row. The plot draws the same line. */
	.gantt-label.group-end::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(-1 * var(--row-gap));
		height: 1px;
		background: var(--background-modifier-border);
	}
	.gantt-label.alt,
	.gantt-row-alt {
		background-image: linear-gradient(var(--kairos-row-alt), var(--kairos-row-alt));
	}
	.gantt-row-alt {
		position: absolute;
		left: 0;
		right: 0;
		pointer-events: none;
	}
	.gantt-group-line {
		position: absolute;
		left: 0;
		right: 0;
		height: 1px;
		background: var(--background-modifier-border);
		pointer-events: none;
	}
	/* While a bar is dragged the cursor holds wherever the pointer wanders: the
	   plot and everything in it take --drag-cursor while it's set. */
	.gantt-plot {
		cursor: var(--drag-cursor, auto);
		position: relative;
		flex: 1;
		min-width: 400px;
		overflow-x: var(--gantt-slide-clip, visible);
	}
	/* A step's slide (slidePlot sets the variables): every child is drawn
	   shifted by the step and eases back to its place. */
	.gantt-plot > * {
		translate: var(--gantt-slide, 0px) 0;
		transition: translate var(--gantt-slide-time, 0s) ease-out;
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
		cursor: var(--drag-cursor, crosshair);
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
		cursor: var(--drag-cursor, grab);
		display: flex;
		align-items: center;
		/* visible so the open-ended arrow cap (::after) isn't clipped; the inner
		   label does its own ellipsis clipping. */
		overflow: visible;
		z-index: 1;
		/* Colored sides, tinted interior: thick accent caps on left/right, a hairline
		   accent top/bottom, and a body filled with the project colour in proportion
		   to intensity (--fill, 0–50%), so an unrated bar stays a plain frame. */
		border: 1px solid color-mix(in srgb, var(--bar-color) 45%, transparent);
		border-left: 3px solid var(--bar-color);
		border-right: 3px solid var(--bar-color);
		background: color-mix(in srgb, var(--bar-color) var(--fill, 0%), var(--background-primary));
	}
	/* Intensity 0: on the books with no time going in — a dashed frame. */
	.gantt-bar.dormant {
		border-style: dashed;
	}
	.gantt-pips {
		display: flex;
		padding-left: 6px;
		flex-shrink: 0;
		color: var(--bar-color);
		position: relative;
		z-index: 3; /* above the left handle */
		/* Bigger than the Grid label's icon, to match the taller bar. */
		--intensity-bar-width: 12px;
		--intensity-bar-height: 3px;
		--intensity-bar-row: 5px;
	}
	.gantt-bar.unrated .gantt-pips {
		visibility: hidden;
	}
	.gantt-bar.unrated:hover .gantt-pips,
	.gantt-bar.unrated.selected .gantt-pips {
		visibility: visible;
		opacity: 0.6;
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
		right: -9px;
		border-top: calc(var(--bar-h) / 2 + 1px) solid transparent;
		border-bottom: calc(var(--bar-h) / 2 + 1px) solid transparent;
		border-left: 9px solid var(--bar-color);
	}
	/* Span whose real start is off-screen left: square that edge (it's cut, not a boundary). */
	.gantt-bar.clamped-start {
		border-left: none;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	/* Selected: accent outline so the keyboard target is obvious, and drawn over
	   its neighbours so the outside handles below stay grabbable. */
	.gantt-bar.selected {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
		z-index: 2;
	}
	.gantt-bar-label {
		flex: 1;
		min-width: 0;
		font-size: 11px;
		padding: 0 6px 0 8px;
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}
	/* A bar with no note shows a muted "No intention" placeholder. */
	.gantt-bar-label.placeholder {
		color: var(--text-faint);
		font-style: italic;
	}
	/* In-place intention editor: occupies the label's slot with no chrome of its
	   own (same font, padding, transparent background) so editing reads as typing
	   directly over the label — the caret and text sit exactly where the label was. */
	.gantt-bar-edit {
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0 6px 0 8px;
		font-size: 11px;
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
	/* An edge's hit zone straddles it: --edge-out past the bar's outer edge (its
	   3px border plus 4px of row) and --handle-in into the body, which the bar
	   sets smaller on a thin bar so there's body left to move it by. It sits
	   above the intensity lines, so the left edge always offers a resize. */
	.gantt-handle {
		--edge-out: 7px;
		position: absolute;
		top: 0;
		width: calc(var(--edge-out) + var(--handle-in, 6px));
		height: 100%;
		cursor: var(--drag-cursor, ew-resize);
		z-index: 4;
	}
	.gantt-handle.left { left: calc(-1 * var(--edge-out)); }
	.gantt-handle.right { right: calc(-1 * var(--edge-out)); }
	/* Pointing at an edge lights it, so you see which one a press will grab. */
	.gantt-handle::before {
		content: "";
		position: absolute;
		top: 0;
		bottom: 0;
		width: 3px;
	}
	.gantt-handle.left::before { left: calc(var(--edge-out) - 3px); }
	.gantt-handle.right::before { right: calc(var(--edge-out) - 3px); }
	.gantt-handle:hover::before { background: var(--interactive-accent); }
	/* The open-ended arrow cap doubles as the right handle's visual affordance. */
	.gantt-bar.open-ended .gantt-handle.right { --edge-out: 13px; }
	/* A selected bar's handles reach further out and show a grip there, so its
	   edges can be grabbed however thin the bar is. */
	.gantt-bar.selected .gantt-handle {
		--edge-out: 15px;
		height: calc(100% + 6px);
		top: -3px;
	}
	.gantt-bar.selected.open-ended .gantt-handle.right { --edge-out: 24px; }
	.gantt-bar.selected .gantt-handle::before {
		width: 10px;
		background: var(--interactive-accent);
		border-radius: var(--kairos-radius-s);
		opacity: 0.85;
	}
	.gantt-bar.selected .gantt-handle.left::before { left: 0; }
	.gantt-bar.selected .gantt-handle.right::before { right: 0; }
	.gantt-bar.selected .gantt-handle:hover::before { opacity: 1; }
	/* Touch (spec decision 137): only a selected bar's edges can be grabbed, so
	   a swipe across a bar scrolls, and they're wide enough for a finger. A ⋯
	   on the selected bar and on each row label opens their menus. */
	.gantt-touch-more {
		display: none;
	}
	@media (pointer: coarse) {
		.gantt-handle {
			pointer-events: none;
		}
		.gantt-bar.selected .gantt-handle {
			pointer-events: auto;
			touch-action: none;
			--edge-out: 24px;
		}
		.gantt-touch-more {
			display: flex;
			align-items: center;
		}
		.gantt-bar-more {
			position: absolute;
			bottom: calc(100% + 4px);
			right: 0;
			z-index: 5;
			background: var(--background-primary);
			border-radius: var(--kairos-radius-m);
			box-shadow: 0 0 0 1px var(--background-modifier-border);
		}
	}
	.gantt-drag-marker {
		position: absolute;
		top: 0;
		width: 2px;
		background: var(--interactive-accent);
		z-index: 3;
		pointer-events: none;
	}
	.gantt-archive-stop {
		position: absolute;
		top: 0;
		width: 0;
		border-left: 2px dashed var(--text-muted);
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
