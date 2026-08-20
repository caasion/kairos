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
	// page — different question (retrospective spans vs. present snapshot).

	import { onMount } from "svelte";
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
		HEADER_HEIGHT,
		LABEL_WIDTH,
		ROW_GAP,
		ROW_HEIGHT,
		WINDOW_PRESETS,
		dateToX,
		getHeaderTicks,
		getRollingViewport,
		shiftDays,
		xToDate,
		xToDay,
	} from "../../gantt/ganttUtils";
	import { historyToSpans, type Span } from "../../gantt/spans";
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

	const rows = $derived.by<GanttRow[]>(() => {
		const out: GanttRow[] = [];
		for (const domain of feed.domains) {
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
			for (const p of feed.projectsByDomain.get(domain.id) ?? []) {
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
		for (const p of feed.orphans) {
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

	// ── Viewport / zoom / pan ──
	let windowDays = $state<number>(180);
	let centerOffset = $state(0); // days panned from today
	const center = $derived(shiftDays(today, centerOffset));
	const viewport = $derived(getRollingViewport(windowDays, center));

	// Measure the plotting area to compute pixels-per-day (window fills the width).
	let plotWidth = $state(0);
	const pxPerDay = $derived(plotWidth > 0 ? plotWidth / windowDays : 0);
	const ticks = $derived(getHeaderTicks(viewport.start, viewport.end, pxPerDay));
	// Today marker sits at the *center* of today's day-column, aligning with the
	// centered day-label above it. Each date owns a full-width column; the label,
	// the column, and this marker must agree or boundaries read ambiguously.
	const todayX = $derived(dateToX(today, viewport.start, pxPerDay) + pxPerDay / 2);

	function pan(dir: 1 | -1) {
		centerOffset += dir * Math.floor(windowDays / 2);
	}
	function jumpToday() {
		centerOffset = 0;
	}

	const rowTop = (i: number) => HEADER_HEIGHT + i * (ROW_HEIGHT + ROW_GAP);
	const contentHeight = $derived(rowTop(rows.length) + ROW_GAP);

	// Base hue for a row: its color, or the theme accent when none.
	const barColor = (row: GanttRow) => row.color || "var(--interactive-accent)";

	// ── Span geometry: clamp to the viewport so off-screen spans don't overflow ──
	// A span occupies whole day-columns: it starts at the *left* boundary of its
	// start day and fills *through* the end day, i.e. up to the left boundary of
	// end+1 (== the right boundary of the end column). This makes a bar's edges land
	// exactly on the grid lines that delimit the labeled days, so the eye can read
	// "this ran from here to here" against the header.
	interface SpanBox {
		left: number;
		width: number;
		clampedStart: boolean; // true when the real start is off-screen to the left
		clampedEnd: boolean; // true when the real end is off-screen to the right
	}
	function spanBox(span: Span): SpanBox | null {
		const clampedStart = span.start < viewport.start;
		const clampedEnd = span.end > viewport.end;
		const start = clampedStart ? viewport.start : span.start;
		const end = clampedEnd ? viewport.end : span.end;
		if (end < viewport.start || start > viewport.end) return null; // fully off-screen
		const left = dateToX(start, viewport.start, pxPerDay);
		// Fill through the end day's column (left boundary of end+1).
		const right = dateToX(shiftDays(end, 1), viewport.start, pxPerDay);
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
			openNewEditor(d.row, start, note);
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

		// Move an existing boundary (start record, or a bounded span's closer).
		if (!d.moved || d.preview === d.anchorDate) return;
		const rec = d.row.entity.history.find((r) => r.date === d.anchorDate);
		if (!rec) return;
		const next = { date: d.preview, status: rec.status, note: rec.note ?? "" };
		if (isDomain) editDomainStatusRecord(index, domain, d.anchorDate, next);
		else editProjectStatusRecord(index, project, d.anchorDate, next);
	}

	// ── Editor: the note/intensity + start date of one active span ──────────────
	// A bar is always active, so the editor no longer picks a status — it edits the
	// active record's start date and its note (the intensity annotation), or deletes
	// the record. It opens two ways: clicking a bar (edit), or on release of a
	// create gesture (name the fresh period). `deleteFromEditor` removes the opening
	// record; the closing `inactive` record (if any) is orphaned harmlessly and can
	// be dragged/removed on its own.
	interface EditTarget {
		row: GanttRow;
		originalDate: ISODate;
	}
	let editTarget = $state<EditTarget | null>(null);
	let editDate = $state<Date>(new Date());
	let editNote = $state("");
	let editPickDate = $state(false);

	function openEditor(row: GanttRow, span: Span) {
		if (drag) return; // a drag just ended — don't also open the popup
		editTarget = { row, originalDate: span.start };
		editDate = dateFromISO(span.start);
		editNote = span.note ?? "";
		editPickDate = false;
	}
	/** Open the editor for a just-created active record (to name its intensity). */
	function openNewEditor(row: GanttRow, date: ISODate, note = "") {
		editTarget = { row, originalDate: date };
		editDate = dateFromISO(date);
		editNote = note;
		editPickDate = false;
	}
	function closeEditor() {
		editTarget = null;
		editPickDate = false;
	}
	// Resolve the *current* row (fresh entity) by its stable key. A captured
	// `row.entity` goes stale the instant an edit writes (the index republishes a new
	// entity), so any follow-up edit must re-read from the live `rows` or it operates
	// on — and re-persists — an out-of-date history, silently dropping the change.
	function currentRow(key: string): GanttRow | undefined {
		return rows.find((r) => r.key === key);
	}
	function commitEditor() {
		const t = editTarget;
		if (!t) return;
		const row = currentRow(t.row.key);
		closeEditor();
		if (!row) return;
		const next = { date: isoFromDate(editDate), status: "active" as LifecycleState, note: editNote.trim() };
		if (row.isDomain) editDomainStatusRecord(index, row.entity as Domain, t.originalDate, next);
		else editProjectStatusRecord(index, row.entity as Project, t.originalDate, next);
	}
	function deleteFromEditor() {
		const t = editTarget;
		if (!t) return;
		const row = currentRow(t.row.key);
		closeEditor();
		if (!row) return;
		if (row.isDomain) removeDomainStatusRecord(index, row.entity as Domain, t.originalDate);
		else removeProjectStatusRecord(index, row.entity as Project, t.originalDate);
	}

	function formatDate(iso: ISODate): string {
		const [y, m, d] = iso.split("-");
		const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
		return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
	}
</script>

<div class="gantt-wrap">
	<!-- Controls -->
	<div class="gantt-controls">
		<button class="gc-btn" title="Pan back" aria-label="Pan back" onclick={() => pan(-1)}>‹</button>
		<button class="gc-btn" title="Pan forward" aria-label="Pan forward" onclick={() => pan(1)}>›</button>
		<button class="gc-btn" onclick={jumpToday}>Today</button>
		<span class="gc-spacer"></span>
		{#each WINDOW_PRESETS as p}
			<button class="gc-zoom" class:active={windowDays === p} onclick={() => (windowDays = p)}>
				{p}d
			</button>
		{/each}
	</div>

	{#if rows.length === 0}
		<div class="gantt-empty">No projects or domains yet.</div>
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
				style:height={`${contentHeight}px`}
				onpointermove={moveDrag}
				onpointerup={endDrag}
				onpointerleave={endDrag}
			>
				<!-- Header ticks + grid lines -->
				<div class="gantt-header" style:height={`${HEADER_HEIGHT}px`}>
					{#each ticks as t}
						<span class="gantt-tick-label" style:left={`${t.x}px`}>{t.label}</span>
					{/each}
				</div>
				{#each ticks as t}
					<div class="gantt-gridline" style:left={`${t.gridX}px`} style:top={`${HEADER_HEIGHT}px`} style:height={`${contentHeight - HEADER_HEIGHT}px`}></div>
				{/each}

				<!-- Today marker -->
				{#if todayX >= 0 && todayX <= plotWidth}
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
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="gantt-bar"
									class:open-ended={openEnded}
									class:clamped-start={box.clampedStart}
									style:left={`${box.left}px`}
									style:width={`${box.width}px`}
									style:top={`${rowTop(i) + (ROW_HEIGHT - BAR_HEIGHT) / 2}px`}
									style:height={`${BAR_HEIGHT}px`}
									style:--bar-h={`${BAR_HEIGHT}px`}
									style:--bar-color={barColor(row)}
									style:--bar-intensity={span.intensity}
									title={`Active${span.note ? " · " + span.note : ""} — ${formatDate(span.start)} → ${span.open ? "now" : formatDate(span.end)}`}
									onclick={() => openEditor(row, span)}
								>
									<!-- Left edge: drag to move this period's start date. -->
									{#if !box.clampedStart}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="gantt-handle left"
											onpointerdown={(e) => beginEdgeDrag(e, "start", row, span, history)}
											title="Drag to move the start date"
										></div>
									{/if}
									<span class="gantt-bar-label">
										{#if span.note}{span.note}{:else}Active{/if}
									</span>
									<!-- Right edge: drag to move the end date, or (open-ended) to set one. -->
									{#if !box.clampedEnd}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="gantt-handle right"
											onpointerdown={(e) => beginEdgeDrag(e, "end", row, span, history)}
											title={openEnded ? "Drag left to set an end date" : "Drag to move the end date"}
										></div>
									{/if}
								</div>
							{/if}
						{/if}
					{/each}
				{/each}

				<!-- Create-drag range preview: a ghost bar between anchor and pointer. -->
				{#if drag && drag.kind === "create" && drag.moved}
					{@const a = drag.anchorDate <= drag.preview ? drag.anchorDate : drag.preview}
					{@const b = drag.anchorDate <= drag.preview ? drag.preview : drag.anchorDate}
					{@const ri = rows.findIndex((r) => r.key === drag!.row.key)}
					<div
						class="gantt-ghost"
						style:left={`${dateToX(a, viewport.start, pxPerDay)}px`}
						style:width={`${dateToX(shiftDays(b, 1), viewport.start, pxPerDay) - dateToX(a, viewport.start, pxPerDay)}px`}
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

<!-- Edit popup (click a span) -->
{#if editTarget}
	<Portal>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="gantt-scrim" onclick={closeEditor}>
			<div class="gantt-card" onclick={(e) => e.stopPropagation()}>
				<div class="gantt-card-head">
					<span class="gantt-card-title">{editTarget.row.label}</span>
					<span class="gc-spacer"></span>
					<button class="gantt-x" aria-label="Close" onclick={closeEditor}>✕</button>
				</div>
				<div class="gantt-edit-row">
					<span class="gantt-edit-label">Active from</span>
					<button class="gc-btn" onclick={() => (editPickDate = !editPickDate)}>{formatDate(isoFromDate(editDate))}</button>
				</div>
				{#if editPickDate}
					<div class="gantt-datepicker"><Datepicker inline bind:value={editDate} onselect={() => (editPickDate = false)} /></div>
				{/if}
				<input class="gantt-note-input" placeholder="intensity note (e.g. baseline / hard / taper)" bind:value={editNote} onkeydown={(e) => { if (e.key === "Enter") commitEditor(); }} />
				<div class="gantt-edit-actions">
					<button class="gc-btn primary" onclick={commitEditor}>Save</button>
					<span class="gc-spacer"></span>
					<button class="gantt-link danger" onclick={deleteFromEditor}>Delete</button>
				</div>
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
	.gantt-controls {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.gc-spacer { flex: 1; }
	.gc-btn {
		height: 26px;
		padding: 0 10px;
		font-size: 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary-alt);
		color: var(--text-normal);
		cursor: pointer;
	}
	.gc-btn:hover { background: var(--background-modifier-hover); }
	.gc-btn.primary {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		border-color: var(--interactive-accent);
	}
	.gc-zoom {
		height: 24px;
		padding: 0 8px;
		font-size: 11px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.gc-zoom.active {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		border-color: var(--interactive-accent);
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
	}
	.gantt-labels {
		flex-shrink: 0;
		border-right: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		position: sticky;
		left: 0;
		z-index: 2;
	}
	.gantt-corner { border-bottom: 1px solid var(--background-modifier-border); }
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
	.gantt-header {
		position: sticky;
		top: 0;
		z-index: 1;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
	}
	.gantt-tick-label {
		position: absolute;
		top: 6px;
		transform: translateX(-50%);
		font-size: 10px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.gantt-gridline {
		position: absolute;
		width: 0;
		border-left: 1px dashed var(--background-modifier-border);
		opacity: 0.6;
	}
	.gantt-today {
		position: absolute;
		top: 0;
		width: 0;
		/* todayX is the column center; pull the line onto it. */
		transform: translateX(-1px);
		border-left: 2px solid var(--color-red, #e5534b);
		opacity: 0.75;
		z-index: 1;
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
		/* Left accent stripe in the base hue (like Holos), body shaded by intensity. */
		border: 1px solid color-mix(in srgb, var(--bar-color) 55%, transparent);
		border-left: 3px solid var(--bar-color);
		background: color-mix(in srgb, var(--bar-color) calc(var(--bar-intensity) * 100%), var(--background-secondary));
	}
	.gantt-bar:hover {
		border-color: color-mix(in srgb, var(--bar-color) 80%, transparent);
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
		top: -1px;
		border-top: calc(var(--bar-h, 22px) / 2 + 1px) solid transparent;
		border-bottom: calc(var(--bar-h, 22px) / 2 + 1px) solid transparent;
		border-left: 8px solid color-mix(in srgb, var(--bar-color) 55%, transparent);
	}
	/* Span whose real start is off-screen left: square that edge (it's cut, not a boundary). */
	.gantt-bar.clamped-start {
		border-left: none;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
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
	.gantt-edit-row { display: flex; gap: 8px; align-items: center; }
	.gantt-edit-label { font-size: 12px; color: var(--text-muted); }
	.gantt-note-input {
		width: 100%;
		height: 28px;
		margin-top: 8px;
		padding: 0 8px;
		font-size: 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary);
		color: var(--text-normal);
	}
	.gantt-datepicker { margin-top: 8px; }
	.gantt-edit-actions { display: flex; align-items: center; margin-top: 12px; }
	.gantt-link { background: none; border: none; font-size: 12px; color: var(--text-muted); cursor: pointer; }
	.gantt-link.danger:hover { color: var(--text-error); }
</style>
