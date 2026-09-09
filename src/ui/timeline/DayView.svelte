<script lang="ts">
	import { TFile } from "obsidian";
	import type { App } from "obsidian";
	import { onMount } from "svelte";
	import type { Readable, Unsubscriber } from "svelte/store";
	import { resolveBlocks } from "../../resolver";
	import type { KairosSettings } from "../../settings";
	import type {
		BacklogEntry,
		Block,
		Day,
		ISODate,
		ResolvedTask,
		Task,
		TaskStatus,
		TimeRange,
	} from "../../types";
	import { makeBlock, nestTaskUnderBlock } from "../../writer";
	import { surfacedOn } from "../../backlogModel";
	import {
		insertEntry,
		resurfaceTomorrow,
		setResurface,
	} from "../../backlogActions";
	import BacklogNudge from "../backlog/BacklogNudge.svelte";
	import { blockOptions, type BlockOption } from "../../blockOptions";
	import { daySignature, type KairosIndex, type Resolver } from "../../index";
	import type { Association } from "../../types";
	import { navigateToAssociation } from "../../navigate";
	import {
		dateFromISO,
		ensureNoteForDate,
		isoFromDate,
		notePathForDate,
		shiftISO,
		todayISO,
	} from "../../dayNote";
	import TimelineBlock from "./TimelineBlock.svelte";
	import TaskRow from "../task/Task.svelte";
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import BlockPicker from "./BlockPicker.svelte";
	import Datepicker from "../components/Datepicker.svelte";
	import { placeUnderAnchor } from "../floating";
	import {
		hitTestDropSlot,
		type DropSlot,
		type TaskDragState,
	} from "./taskDrag";
	import {
		type Gesture,
		beginBlockGesture,
		beginCreateGesture,
		updateGesture,
	} from "./interactions";
	import {
		geometryFromSettings,
		gridHeight,
		layoutBlocks,
		minutesToOffset,
		visibleHours,
	} from "./layout";

	// A request to reveal a block, pushed by the Grid's block badge. Kept minimal
	// and local to avoid importing from main.ts (which imports this view).
	interface RevealRequest {
		date: ISODate;
		blockLine: number;
		nonce: number;
	}

	interface Props {
		app: App;
		index: KairosIndex;
		// Reactive settings store: the plugin republishes it on every write, so a
		// change from here, the Week view, or the settings tab reaches us live.
		settings$: Readable<KairosSettings>;
		// Cross-view reveal channel (Grid badge → jump + scroll to a block).
		reveal$: Readable<RevealRequest | null>;
		// The one write path back to the plugin; it persists and republishes.
		updateSettings: (mutate: (s: KairosSettings) => void) => void;
	}

	let { app, index, settings$, reveal$, updateSettings }: Props = $props();

	// Local reactive view of the settings. `$store` auto-subscribes, so every
	// derived below recomputes the instant the plugin republishes.
	const settings = $derived($settings$);

	// Live association resolver: re-tints tags when a project/domain file changes.
	// Starts as a pass-through so the first render before subscription is neutral.
	let resolve = $state<Resolver>(() => ({ displayName: "", resolved: false }));

	// Ctrl-click an association tag → open its project/domain in a new tab. A tag
	// that doesn't resolve to a real file is inert (navigateToAssociation no-ops).
	function onNavigate(assoc: Association) {
		navigateToAssociation(app, resolve(assoc));
	}

	// ── Resurfaced backlog nudges ──
	// Entries with a resurface date surface as nudges on one day (max(resurface,
	// today)). They live in the backlog file, not this day, until inserted.
	let backlogEntries = $state<BacklogEntry[]>([]);

	function onNudgeInsert(entry: BacklogEntry) {
		void insertEntry(index, entry, date);
	}
	function onNudgeResurfaceTomorrow(entry: BacklogEntry) {
		resurfaceTomorrow(index, backlogEntries, entry);
	}

	// Resurface-at: a portal'd inline datepicker anchored to the nudge's snooze
	// button. Reuses the same float-at-a-rect approach as the association picker.
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
	// Once the popup renders, measure its real size and clamp it inside the
	// viewport (flipping above the anchor when a below placement would overflow).
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

	// Geometry follows the persisted hour-range / zoom settings, live.
	const geo = $derived(geometryFromSettings(settings));
	const hours = $derived(visibleHours(geo));
	const bodyHeight = $derived(gridHeight(geo));

	// Inline hour-range control (Holos-style popover in the header).
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

	function handleClickOutside(event: MouseEvent) {
		if (
			showControls &&
			controlsRef &&
			!controlsRef.contains(event.target as Node)
		) {
			showControls = false;
		}
		if (
			showCalendar &&
			dateNavRef &&
			!dateNavRef.contains(event.target as Node)
		) {
			showCalendar = false;
		}
	}

	let blocks = $state<Block[]>([]);
	// The view owns a date, defaulting to today, independent of the active file.
	// Navigation (arrows / calendar) changes this; nothing else does.
	let date = $state<ISODate>(todayISO());
	// Backlog nudges surfacing on the shown day (declared here, after `date`).
	const surfaced = $derived(surfacedOn(backlogEntries, date, todayISO()));
	// The daily note backing `date`, or null when that day has no note yet. An
	// empty day still renders (an empty timeline) — the note is created lazily on
	// the first write (see `notePathForWrite`).
	let notePath = $state<string | null>(null);

	// Calendar popup (Holos Datepicker, inline mode) toggled from the date label.
	let showCalendar = $state(false);
	let calendarValue = $state<Date>(dateFromISO(todayISO()));
	let dateNavRef = $state<HTMLDivElement>();

	// A human-friendly header label, e.g. "Thu, Jul 31". The ISO date remains the
	// source of truth; this is display only.
	const dateLabel = $derived(
		dateFromISO(date).toLocaleDateString(undefined, {
			weekday: "short",
			month: "short",
			day: "numeric",
		}),
	);

	// Resolved tasks are derived from `blocks`, so an in-place edit to a block or
	// task (see the handlers below) flows through to the render automatically —
	// no separate reassignment to keep in sync.
	const resolved = $derived(resolveBlocks(blocks, date));

	// A live-updating "now" offset, so the needle tracks real time.
	let nowMinutes = $state(currentMinutes());
	function currentMinutes(): number {
		const d = new Date();
		return d.getHours() * 60 + d.getMinutes();
	}

	// Subscription to the current date's day store. Rebuilt whenever `date`
	// changes; adopting the store's blocks is guarded (see `adoptDay`).
	let unsubscribeDay: Unsubscriber | null = null;

	// Point the view at `date`: resolve its note path (may be null if the day has
	// no note yet), subscribe to that day's store, and seed `blocks` from the
	// index. Called on mount and after every navigation.
	function retarget() {
		unsubscribeDay?.();
		unsubscribeDay = null;

		notePath = notePathForDate(date);
		calendarValue = dateFromISO(date);
		blocks = [];

		unsubscribeDay = index.day(date).subscribe((day) => adoptDay(day));
	}

	// ── Day navigation ──────────────────────────────────────────────
	// Changing `date` re-points the subscription. A mid-gesture guard isn't
	// needed here (nav controls aren't reachable during a drag), but resetting
	// interaction state keeps a stale preview from leaking across days.

	function goToDate(next: ISODate) {
		if (next === date) return;
		selection = new Set();
		preview = new Map();
		draft = null;
		date = next;
		retarget();
	}

	function goToday() {
		goToDate(todayISO());
	}

	// ── Cross-view reveal (Grid block badge → here) ──────────────────
	// A request navigates to its date (if different) and scrolls the block into
	// view + flashes it. Nonce-guarded so a repeat click on the same block still
	// fires. The scroll waits a frame so the block DOM exists after a date change.
	let lastRevealNonce = -1;
	let scrollEl = $state<HTMLDivElement>();

	function handleReveal(req: RevealRequest | null) {
		if (!req || req.nonce === lastRevealNonce) return;
		lastRevealNonce = req.nonce;
		if (req.date !== date) goToDate(req.date);
		const line = req.blockLine;
		// Two rAFs: one for the date-change render, one for layout to settle.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => scrollToBlock(line)),
		);
	}

	function scrollToBlock(line: number) {
		const el = scrollEl?.querySelector<HTMLElement>(
			`[data-block-line="${line}"]`,
		);
		if (!el) return;
		el.scrollIntoView({ behavior: "smooth", block: "center" });
		el.classList.add("reveal-flash");
		window.setTimeout(() => el.classList.remove("reveal-flash"), 1200);
	}

	function stepDay(delta: number) {
		goToDate(shiftISO(date, delta));
	}

	function onCalendarSelect(picked: Date) {
		showCalendar = false;
		goToDate(isoFromDate(picked));
	}

	// Ctrl/Cmd+click the date label opens (creating if needed) that day's note.
	async function openDayNote(event: MouseEvent) {
		if (!(event.ctrlKey || event.metaKey)) {
			showCalendar = !showCalendar;
			return;
		}
		event.preventDefault();
		const path = await ensureNoteForDate(date);
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			void app.workspace.getLeaf("tab").openFile(file);
		}
	}

	const isToday = $derived(date === todayISO());

	// Adopt the index's version of the day into local `blocks`. This is the read
	// side of the optimistic loop: the index pushes here on cold-load and on
	// genuine external edits, but NOT on the echo of our own write (the index
	// drops those via daySignature). Two guards keep an incoming push from
	// clobbering an in-progress edit:
	//   1. never adopt mid-gesture (a drag owns the blocks until it commits),
	//   2. skip if the incoming schedule already matches ours (nothing to do).
	// Together these preserve the in-place editing model below — the store is
	// the source and sink, not a live re-render feed during interaction.
	function adoptDay(day: Day | undefined) {
		if (gesture) return;
		const incoming = day?.blocks ?? [];
		if (daySignature(incoming) === daySignature(blocks)) return;
		blocks = incoming;
	}

	function handleBlockDelete(blockToDelete: Block) {
		const real = ownerFor(blockToDelete);
		if (!real) return;
		selection = new Set();
		// Deletion changes the array, so reassign locally (removal doesn't have
		// the reorder/identity problem an edit does), then write.
		blocks = blocks.filter((b) => b !== real);
		void writeToDisk();
	}

	// ── Write-back ──────────────────────────────────────────────────
	// The model: an edit mutates the live view object *in place*. `blocks` is
	// never reassigned on an edit, so nothing the render keys on changes identity
	// — no re-diff, no flicker, no lost focus/selection. The disk write is a pure
	// background side effect that reflects the state we already updated; we do
	// not read anything back from it.
	//
	// Because `blocks` is $state, Svelte 5 deep-proxies it: assigning a field on
	// a live block/task (e.g. `real.time = time`) is reactive and updates only
	// that field's DOM. `resolved` is $derived from `blocks`, so it follows too.
	//
	// In-memory array order intentionally drifts from file order: the file is
	// time-sorted on write, but the display sorts by time itself (layoutBlocks),
	// so the array's order is never observed. This is what lets a retime skip a
	// reorder — and thus skip the identity churn that a reorder would cause.

	function ownerFor(owner: Block): Block | undefined {
		return blocks.find((b) => b.source.line === owner.source.line);
	}

	function realTask(owner: Block, target: Task): Task | undefined {
		if (owner.status !== undefined && owner.source.line === target.source.line) {
			// Colocated task: it *is* the block, patched via block fields below.
			return undefined;
		}
		return owner.tasks.find((t) => t.source.line === target.source.line);
	}

	// Push the current `blocks` to the index. Optimistic: the index updates its
	// own memory immediately and debounces the file write; echo suppression is
	// the index's job (via daySignature), so there's nothing to track here. The
	// view is already correct — we mutated it in place — so we adopt nothing back.
	//
	// When the current day has no note yet, the first edit creates it: we resolve
	// (and if necessary create) the path, then apply. `ensureNoteForDate` is
	// idempotent, so a burst of edits before the create resolves is harmless — the
	// debounced write in the index only ever targets the final path.
	function writeToDisk() {
		if (notePath !== null) {
			index.applyDayEdit(date, notePath, blocks);
			return;
		}
		const forDate = date;
		void ensureNoteForDate(forDate).then((path) => {
			// The user may have navigated away while the note was being created;
			// only adopt the path if we're still on the same day.
			if (date === forDate) notePath = path;
			index.applyDayEdit(forDate, path, blocks);
		});
	}

	function handleSetTaskStatus(owner: Block, task: Task, status: TaskStatus) {
		const real = ownerFor(owner);
		if (!real) return;
		if (real.status !== undefined && real.source.line === task.source.line) {
			real.status = status; // colocated task → block's own status
		} else {
			const t = realTask(real, task);
			if (!t) return;
			t.status = status;
		}
		void writeToDisk();
	}

	function handleSetTaskText(owner: Block, task: Task, text: string) {
		const real = ownerFor(owner);
		if (!real) return;
		if (real.status !== undefined && real.source.line === task.source.line) {
			real.title = text; // colocated task text is the block title
		} else {
			const t = realTask(real, task);
			if (!t) return;
			t.text = text;
		}
		void writeToDisk();
	}

	function handleDeleteTask(owner: Block, task: Task) {
		const real = ownerFor(owner);
		if (!real) return;
		if (real.status !== undefined && real.source.line === task.source.line) {
			// Deleting a colocated task drops the block's checkbox, keeps the block.
			delete real.status;
			delete real.metadata;
		} else {
			real.tasks = real.tasks.filter((t) => t.source.line !== task.source.line);
		}
		void writeToDisk();
	}

	// ── Block field write-back ──────────────────────────────────────

	function handleSetBlockTitle(block: Block, title: string) {
		const real = ownerFor(block);
		if (!real) return;
		real.title = title;
		void writeToDisk();
	}

	function handleSetBlockTime(block: Block, time: TimeRange) {
		const real = ownerFor(block);
		if (!real) return;
		real.time = time; // in place — array position (and thus identity) unchanged
		void writeToDisk();
	}

	function handleSetBlockStatus(block: Block, status: TaskStatus) {
		const real = ownerFor(block);
		if (real?.status === undefined) return;
		real.status = status;
		void writeToDisk();
	}

	// Convert a plain block into a checkable one (a colocated task) or back. The
	// colocated task shares the block's line, so "becoming a task" is just adding
	// a status; "becoming a plain block again" drops the status and any metadata
	// that rode on that line (mirroring handleDeleteTask's colocated branch).
	function handleToggleBlockCheckable(block: Block) {
		const real = ownerFor(block);
		if (!real) return;
		if (real.status === undefined) {
			real.status = " ";
		} else {
			delete real.status;
			delete real.metadata;
		}
		void writeToDisk();
	}

	// A monotonically-decreasing line number for tasks created in-session, so two
	// fresh tasks don't collide on the source line the render keys on before the
	// write's reparse re-derives real lines. Any negative is a safe placeholder
	// (real lines are >= 0).
	let nextDraftLine = -2;

	function handleAddTask(block: Block) {
		const real = ownerFor(block);
		if (!real) return;
		const task: Task = {
			source: { path: real.source.path, line: nextDraftLine-- },
			text: "New task",
			status: " ",
		};
		real.tasks = [...real.tasks, task];
		void writeToDisk();
	}

	function handleSetBlockAssoc(block: Block, assoc: Association | null) {
		const real = ownerFor(block);
		if (!real) return;
		if (assoc) real.assoc = assoc;
		else delete real.assoc;
		void writeToDisk();
	}

	function handleSetTaskAssoc(owner: Block, task: Task, assoc: Association | null) {
		const real = ownerFor(owner);
		if (!real) return;
		// A colocated task is the block itself; associate the block instead.
		if (real.status !== undefined && real.source.line === task.source.line) {
			if (assoc) real.assoc = assoc;
			else delete real.assoc;
		} else {
			const t = realTask(real, task);
			if (!t) return;
			if (assoc) t.assoc = assoc;
			else delete t.assoc;
		}
		void writeToDisk();
	}

	// Nest a task under `destination` at `index`. Unlike the in-place edits above,
	// the nest is a whole-array transform (materialize-on-move lives in the
	// writer), so we reassign `blocks` from its result and persist. A no-op result
	// (same array) simply writes nothing new.
	function handleNestTask(
		owner: Block,
		task: Task,
		destination: Block,
		index?: number,
	) {
		const next = nestTaskUnderBlock(blocks, owner, task, destination, index);
		if (next === blocks) return;
		blocks = next;
		void writeToDisk();
	}

	// ── Block picker (nest-under-block) ──────────────────────────────
	// The task menu / action opens this; picking a block nests the task under it
	// (appending to that block's tasks). Owned here (like the assoc picker) so it
	// escapes the canvas clip.
	let blockPickerTarget = $state<{ owner: Block; task: Task } | null>(null);
	let blockPickerAnchor = $state<DOMRect | null>(null);

	// Offer every block except the task's current owner (nesting where it already
	// lives is a no-op the picker shouldn't advertise).
	const blockPickerOptions = $derived.by<BlockOption[]>(() =>
		blockPickerTarget
			? blockOptions(blocks, blockPickerTarget.owner.source.line)
			: [],
	);

	function openBlockPicker(owner: Block, task: Task, anchor: DOMRect) {
		blockPickerTarget = { owner, task };
		blockPickerAnchor = anchor;
	}

	function closeBlockPicker() {
		blockPickerTarget = null;
		blockPickerAnchor = null;
	}

	function onPickBlock(option: BlockOption) {
		if (blockPickerTarget) {
			handleNestTask(blockPickerTarget.owner, blockPickerTarget.task, option.block);
		}
		closeBlockPicker();
	}

	// ── Association picker ───────────────────────────────────────────
	// A single floating picker, opened from a block's or task's context menu /
	// action. DayView owns it (not the block) so it isn't clipped by the canvas.
	// The target is either a block or a (block, task) pair.
	type PickerTarget =
		| { kind: "block"; block: Block }
		| { kind: "task"; block: Block; task: Task };

	let pickerTarget = $state<PickerTarget | null>(null);
	let pickerAnchor = $state<DOMRect | null>(null);

	// The association currently on the target, to preselect / offer "Clear".
	const pickerCurrent = $derived.by(() => {
		if (!pickerTarget) return undefined;
		return pickerTarget.kind === "block"
			? pickerTarget.block.assoc
			: pickerTarget.task.assoc;
	});

	function openAssocPicker(block: Block, anchor: DOMRect) {
		pickerTarget = { kind: "block", block };
		pickerAnchor = anchor;
	}

	function openTaskAssocPicker(block: Block, task: Task, anchor: DOMRect) {
		pickerTarget = { kind: "task", block, task };
		pickerAnchor = anchor;
	}

	function closeAssocPicker() {
		pickerTarget = null;
		pickerAnchor = null;
	}

	function onPickAssoc(assoc: Association | null) {
		if (pickerTarget?.kind === "block") {
			handleSetBlockAssoc(pickerTarget.block, assoc);
		} else if (pickerTarget?.kind === "task") {
			handleSetTaskAssoc(pickerTarget.block, pickerTarget.task, assoc);
		}
		closeAssocPicker();
	}

	// Tasks keyed by their block's source line, so lookups survive the preview
	// pass (which clones blocks into new objects but keeps their source).
	const tasksBySource = $derived.by(() => {
		const map = new Map<number, ResolvedTask[]>();
		for (const block of blocks) map.set(block.source.line, []);
		for (const task of resolved) map.get(task.block.source.line)?.push(task);
		return map;
	});

	// ── Interaction state ──────────────────────────────────────────
	// A live gesture (move/resize/create) previews in local state and only
	// writes on drop, so the file isn't churned mid-drag (and the timeline
	// doesn't flicker from re-parsing under the pointer).

	let selection = $state<Set<Block>>(new Set());
	let gesture = $state<Gesture | null>(null);
	// Previewed ranges for blocks under an active move/resize, keyed by block.
	let preview = $state<Map<Block, TimeRange>>(new Map());
	// A create gesture's sketched range, positioned but not yet a real block.
	let draft = $state<TimeRange | null>(null);
	let canvasEl = $state<HTMLDivElement>();

	// ── Task drag-to-nest state ─────────────────────────────────────
	// A separate gesture from block move/resize: a task grabbed by long-press,
	// dragged over blocks, and dropped into one. Tracked here (the canvas owner)
	// because the drop target is a sibling block the task can't see. `taskDrop` is
	// the live insertion slot passed down so the hovered block draws an indicator.
	let taskDrag = $state<TaskDragState | null>(null);
	let taskDrop = $state<DropSlot | null>(null);

	// Blocks with the live preview applied, so layout math sees the dragged
	// position. Untimed blocks pass through untouched.
	const displayBlocks = $derived.by(() => {
		if (preview.size === 0) return blocks;
		return blocks.map((b) => {
			const time = preview.get(b);
			return time ? { ...b, time } : b;
		});
	});

	const placements = $derived(layoutBlocks(displayBlocks, geo));

	// Map a display block back to its selection membership. Preview produces new
	// objects, so we compare by source line (stable within a render).
	const selectedLines = $derived(
		new Set([...selection].map((b) => b.source.line)),
	);
	function isSelected(b: Block): boolean {
		return selectedLines.has(b.source.line);
	}

	// The draft rectangle, if a create gesture has covered enough distance.
	const draftRect = $derived(
		draft
			? {
					top: minutesToOffset(draft.start, geo),
					height: minutesToOffset(draft.end, geo) - minutesToOffset(draft.start, geo),
				}
			: null,
	);

	// Untimed blocks (the Unscheduled inbox and any other untimed item) render as
	// a collapsible list above the timeline, since they have no position on it.
	const unscheduled = $derived(blocks.filter((b) => !b.scheduled));
	let unscheduledOpen = $state(true);

	const needleTop = $derived(minutesToOffset(nowMinutes, geo));
	const needleVisible = $derived(
		nowMinutes >= geo.startHour * 60 && nowMinutes <= geo.endHour * 60,
	);

	// ── Gesture lifecycle ──────────────────────────────────────────

	// Pointer offset (px) from the top of the canvas body for an event.
	function canvasOffset(event: PointerEvent): number {
		const rect = canvasEl?.getBoundingClientRect();
		return event.clientY - (rect?.top ?? 0);
	}

	// A gesture only "commits" once the pointer has moved past this many pixels,
	// so a plain click selects (or does nothing) instead of nudging a block by a
	// stray pixel.
	const DRAG_THRESHOLD_PX = 3;
	let gestureOriginY = $state(0);
	let gestureMoved = $state(false);

	// Started from a block (move or resize). Selection rules follow the platform
	// convention: shift/ctrl toggles, a plain press on an unselected block makes
	// it the sole selection.
	function onBlockGestureStart(
		mode: "move" | "resize-top" | "resize-bottom",
		block: Block,
		event: PointerEvent,
	) {
		const additive = event.shiftKey || event.metaKey || event.ctrlKey;

		if (additive) {
			const next = new Set(selection);
			if (next.has(block)) next.delete(block);
			else next.add(block);
			selection = next;
		} else if (!selection.has(block)) {
			selection = new Set([block]);
		}

		// Resize always acts on the single grabbed block; move acts on the whole
		// selection so a group can be dragged together.
		const targets =
			mode === "move" && selection.size > 0 ? [...selection] : [block];

		gesture = beginBlockGesture(mode, targets, canvasOffset(event), geo);
		gestureOriginY = event.clientY;
		gestureMoved = false;
		capturePointer(event);
	}
 
	// Pressed on empty canvas: begin a create gesture and clear any selection.
	function onCanvasPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		// Ignore presses that landed on a block (those bubble here after their own
		// handler ran); a block press sets `gesture` already.
		if (gesture) return;
		selection = new Set();
		gesture = beginCreateGesture(canvasOffset(event), geo);
		gestureOriginY = event.clientY;
		gestureMoved = false;
		capturePointer(event);
	}

	function capturePointer(event: PointerEvent) {
		(event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!gesture) return;
		// Suppress sub-threshold jitter so a click isn't read as a drag.
		if (
			!gestureMoved &&
			Math.abs(event.clientY - gestureOriginY) < DRAG_THRESHOLD_PX
		) {
			return;
		}
		gestureMoved = true;
		const p = updateGesture(gesture, canvasOffset(event), notePath ?? "");
		preview = p.ranges;
		draft = p.draft ?? null;
	}

	async function onPointerUp() {
		if (!gesture) return;
		const g = gesture;
		const committedPreview = preview;
		const committedDraft = draft;
		const moved = gestureMoved;

		// Reset interaction state before persisting; the reparse from the write
		// will rebuild block identities anyway.
		gesture = null;
		preview = new Map();
		draft = null;

		if (!moved) return; // a click, not a drag — selection already handled

		if (g.mode === "create") {
			if (committedDraft) await commitCreate(committedDraft);
			return;
		}
		if (committedPreview.size > 0) await commitRetime(committedPreview);
	}

	async function commitRetime(ranges: Map<Block, TimeRange>) {
		// Apply each new range in place on the live block. `ranges` is keyed by the
		// preview's block objects; match back to the live array by source line.
		for (const [previewBlock, time] of ranges) {
			const real = ownerFor(previewBlock);
			if (real) real.time = time;
		}
		// Selection is intentionally preserved — the dragged block stays selected,
		// so it keeps focus and its handles.
		await writeToDisk();
	}

	async function commitCreate(range: TimeRange) {
		// Create into the current day's note, making the note if it doesn't exist
		// yet. `makeBlock` only needs the path for its SourceRef; a placeholder is
		// fine because the block's identity is re-derived on the next reparse.
		const forDate = date;
		const path = notePath ?? (await ensureNoteForDate(forDate));
		// The create may have awaited note-creation across a navigation. If the
		// day changed underneath us, drop this block rather than land it on the
		// wrong day's timeline.
		if (date !== forDate) return;
		notePath = path;
		// A unique negative line so two blocks created before the reparse don't
		// collide on the source line the keyed `{#each}` renders by (a duplicate
		// key freezes reconciliation). Shares the task draft-line counter so no
		// unsaved block and task collide either.
		const block = makeBlock(range, path, undefined, nextDraftLine--);
		blocks = [...blocks, block]; // growing the array doesn't reorder existing ones
		await writeToDisk();
		if (settings.askAssocOnBlockCreate) askAssocFor(block);
	}

	// Open the association picker on a block that was just created. The picker is
	// anchored to the block's own element, which only exists after the create has
	// rendered — hence the frame wait. Silently skipped if the element isn't there
	// (the day was navigated away from mid-create).
	function askAssocFor(block: Block) {
		requestAnimationFrame(() => {
			const el = scrollEl?.querySelector<HTMLElement>(
				`[data-block-line="${block.source.line}"]`,
			);
			if (el) openAssocPicker(block, el.getBoundingClientRect());
		});
	}

	// ── Task drag-to-nest lifecycle ─────────────────────────────────
	// Long-press on a task body fires this. We enter a drag: block gestures are
	// suppressed for its duration, the window move/up listeners route to the drag
	// (see onMount), and a ghost follows the pointer. Dropping over a block nests
	// the task there; dropping elsewhere (or Escape) cancels.

	function onTaskGrab(owner: Block, task: Task, event: PointerEvent) {
		// A grabbed task shouldn't also be starting a block move; clear any gesture
		// the underlying press may have armed.
		gesture = null;
		preview = new Map();
		draft = null;
		selection = new Set();
		taskDrag = {
			owner,
			task,
			ghostX: event.clientX,
			ghostY: event.clientY,
			label: task.text,
		};
		taskDrop = hitTestDropSlot(event, canvasEl ? [canvasEl] : undefined);
	}

	function onTaskDragMove(event: PointerEvent) {
		if (!taskDrag) return;
		taskDrag = { ...taskDrag, ghostX: event.clientX, ghostY: event.clientY };
		taskDrop = hitTestDropSlot(event, canvasEl ? [canvasEl] : undefined);
	}

	function onTaskDragUp() {
		if (!taskDrag) return;
		const drag = taskDrag;
		const drop = taskDrop;
		taskDrag = null;
		taskDrop = null;
		if (!drop) return; // released off any block — cancel

		const destination = blocks.find((b) => b.source.line === drop.blockLine);
		if (!destination) return;
		handleNestTask(drag.owner, drag.task, destination, drop.index);
	}

	function cancelTaskDrag() {
		taskDrag = null;
		taskDrop = null;
	}

	// Portal the drag ghost to <body> so `position: fixed` resolves against the
	// viewport, not a transformed leaf-container ancestor (same reason the pickers
	// portal — see AssociationPicker).
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			},
		};
	}

	async function deleteSelected() {
		if (selection.size === 0) return;
		const doomed = new Set([...selection].map((b) => b.source.line));
		selection = new Set();
		blocks = blocks.filter((b) => !doomed.has(b.source.line));
		await writeToDisk();
	}

	function isEditableTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName;
		return (
			tag === "INPUT" ||
			tag === "TEXTAREA" ||
			target.isContentEditable
		);
	}

	function onKeyDown(event: KeyboardEvent) {
		// Don't hijack keys while the user is typing in a textbox/editor.
		if (isEditableTarget(event.target)) return;

		// Escape cancels a live task drag first (before clearing selection).
		const key = event.key.toLowerCase();
		if (key === "escape" && taskDrag) {
			event.preventDefault();
			cancelTaskDrag();
			return;
		}

		// X (or Delete/Backspace) removes the current selection.
		if (key === "x" || key === "delete" || key === "backspace") {
			if (selection.size === 0) return;
			event.preventDefault();
			void deleteSelected();
		} else if (key === "escape") {
			selection = new Set();
		}
	}

	onMount(() => {
		retarget();

		// Track the live resolver so tags re-tint when project/domain files change.
		const unsubscribeResolver = index.resolver().subscribe((r) => {
			resolve = r;
		});

		// Track the backlog so resurfaced entries surface as nudges (and update
		// live when the backlog file changes or an entry is inserted/snoozed).
		const unsubscribeBacklog = index.backlog().subscribe((e) => {
			backlogEntries = e;
		});

		// React to Grid block-badge clicks: jump to the date + scroll to the block.
		const unsubscribeReveal = reveal$.subscribe((req) => handleReveal(req));

		// The Day view no longer follows the active file — it owns its own date
		// (defaulting to today, navigable via the header). Genuine external edits
		// to the shown day arrive through the day store's subscription (adoptDay).
		const tick = window.setInterval(() => {
			nowMinutes = currentMinutes();
		}, 60_000);

		// Window-level so a drag keeps tracking even when the pointer leaves a
		// block or the canvas entirely. A live task drag takes precedence over a
		// block gesture (the two can't run at once — grabbing a task clears any
		// block gesture), so route to it first.
		const move = (e: PointerEvent) => {
			if (taskDrag) onTaskDragMove(e);
			else onPointerMove(e);
		};
		const up = () => {
			if (taskDrag) onTaskDragUp();
			else void onPointerUp();
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);

		return () => {
			unsubscribeDay?.();
			unsubscribeResolver();
			unsubscribeBacklog();
			unsubscribeReveal();
			window.clearInterval(tick);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- tabindex lets the view receive the X / Delete / Escape keys for the
     current block selection. -->
<div
	class="day-view"
	tabindex="-1"
	onclick={handleClickOutside}
	onkeydown={onKeyDown}
>
	<div class="day-header">
		<div class="day-nav" bind:this={dateNavRef}>
			<button
				class="icon-btn nav-btn"
				onclick={(e) => {
					e.stopPropagation();
					stepDay(-1);
				}}
				aria-label="Previous day"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
			</button>

			<button
				class="day-date"
				class:today={isToday}
				title="Click to pick a date · Ctrl+click to open the daily note"
				onclick={(e) => {
					e.stopPropagation();
					void openDayNote(e);
				}}
			>
				{dateLabel}
			</button>

			<button
				class="icon-btn nav-btn"
				onclick={(e) => {
					e.stopPropagation();
					stepDay(1);
				}}
				aria-label="Next day"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
			</button>

			{#if !isToday}
				<button
					class="today-btn"
					onclick={(e) => {
						e.stopPropagation();
						goToday();
					}}
				>
					Today
				</button>
			{/if}

			{#if showCalendar}
				<div class="calendar-popup">
					<Datepicker
						inline
						bind:value={calendarValue}
						onselect={onCalendarSelect}
					/>
				</div>
			{/if}
		</div>

		<span class="day-header-spacer"></span>
		<span class="day-range-label">
			{String(geo.startHour).padStart(2, "0")}:00–{String(geo.endHour).padStart(2, "0")}:00
		</span>
		<div class="controls-wrap" bind:this={controlsRef}>
			<button
				class="icon-btn"
				onclick={(e) => {
					e.stopPropagation();
					showControls = !showControls;
				}}
				aria-label="Timeline settings"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
			</button>

			{#if showControls}
				<div class="controls-popup">
					<label class="controls-field">
						<span class="controls-label">Start hour</span>
						<input
							type="number"
							class="controls-input"
							min="0"
							max="23"
							value={geo.startHour}
							oninput={(e) => setStartHour(+e.currentTarget.value)}
						/>
					</label>
					<label class="controls-field">
						<span class="controls-label">End hour</span>
						<input
							type="number"
							class="controls-input"
							min="1"
							max="24"
							value={geo.endHour}
							oninput={(e) => setEndHour(+e.currentTarget.value)}
						/>
					</label>
					<label class="controls-field">
						<span class="controls-label">Hour height</span>
						<input
							type="number"
							class="controls-input"
							min="20"
							max="240"
							step="5"
							value={geo.hourHeight}
							oninput={(e) => setHourHeight(+e.currentTarget.value)}
						/>
					</label>
				</div>
			{/if}
		</div>
	</div>

	<!-- The timeline always renders, even for a day with no note yet: creating a
	     block on an empty day lazily creates the daily note (see writeToDisk). -->
	<div class="day-scroll" bind:this={scrollEl}>
		{#if unscheduled.length > 0}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class="day-unscheduled">
				<div
					class="us-header"
					class:open={unscheduledOpen}
					onclick={() => (unscheduledOpen = !unscheduledOpen)}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="us-chevron"><path d="m6 9 6 6 6-6"/></svg>
					<span>Unscheduled</span>
					<span class="us-count">{unscheduled.reduce((n, b) => n + (tasksBySource.get(b.source.line) ?? []).filter((t) => !t.colocated).length, 0)}</span>
				</div>
				{#if unscheduledOpen}
					{#each unscheduled as block (block.source.line)}
						{@const tasks = tasksBySource.get(block.source.line) ?? []}
						{#each tasks.filter((t) => !t.colocated) as task (task.source.line)}
							{@const r = task.owner ? resolve(task.owner) : undefined}
							<TaskRow
								{task}
								color={r?.color}
								association={task.assoc ?? task.owner}
								inherited={task.assoc === undefined && task.owner !== undefined}
								resolved={r}
								onNavigate={() => task.owner && onNavigate(task.owner)}
								onEditAssoc={(rect) => openTaskAssocPicker(block, task, rect)}
								onNest={(rect) => openBlockPicker(block, task, rect)}
								onSetStatus={(_t, status) => handleSetTaskStatus(block, task, status)}
								onSetText={(_t, text) => handleSetTaskText(block, task, text)}
								onDelete={(_t) => handleDeleteTask(block, task)}
								onGrab={(e) => onTaskGrab(block, task, e)}
							/>
						{/each}
					{/each}
				{/if}
			</div>
		{/if}

		<!-- Resurfacing: backlog nudges due on this day. A separate section, like
		     Unscheduled, but the items live in the backlog until inserted. -->
		{#if surfaced.length > 0}
			<div class="day-resurfacing">
				<div class="rs-header">
					<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
					<span>Resurfacing</span>
					<span class="rs-count">{surfaced.length}</span>
				</div>
				{#each surfaced as entry (entry.source.line)}
					<BacklogNudge
						{entry}
						resolved={entry.assoc ? resolve(entry.assoc) : undefined}
						onInsert={onNudgeInsert}
						onResurfaceTomorrow={onNudgeResurfaceTomorrow}
						onResurfaceAt={onNudgeResurfaceAt}
						{onNavigate}
					/>
				{/each}
			</div>
		{/if}

		<div class="day-body" style={`height: ${bodyHeight}px;`}>
				<!-- Hour gutter -->
				<div class="day-gutter">
					{#each hours as hour (hour)}
						<div
							class="day-hour-label"
							style={`top: ${minutesToOffset(hour * 60, geo)}px;`}
						>
							{String(hour).padStart(2, "0")}:00
						</div>
					{/each}
				</div>

				<!-- Positioned blocks + grid lines. Pressing empty canvas starts a
				     create-drag; presses on a block are handled by the block. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="day-canvas"
					class:creating={gesture?.mode === "create"}
					bind:this={canvasEl}
					onpointerdown={onCanvasPointerDown}
				>
					{#each hours as hour (hour)}
						<div
							class="day-hour-line"
							style={`top: ${minutesToOffset(hour * 60, geo)}px;`}
						></div>
					{/each}

					{#if needleVisible}
						<div class="day-needle" style={`top: ${needleTop}px;`}></div>
					{/if}

					{#each placements as p (p.block.source.line)}
						<TimelineBlock
							block={p.block}
							tasks={tasksBySource.get(p.block.source.line) ?? []}
							top={p.top}
							height={p.height}
							column={p.column}
							lanes={p.lanes}
							selected={isSelected(p.block)}
							dragging={gesture !== null && isSelected(p.block)}
							{resolve}
							{onNavigate}
							onGestureStart={onBlockGestureStart}
							onDelete={handleBlockDelete}
							onSetTaskStatus={handleSetTaskStatus}
							onSetTaskText={handleSetTaskText}
							onDeleteTask={handleDeleteTask}
							onSetBlockTitle={handleSetBlockTitle}
							onSetBlockTime={handleSetBlockTime}
							onSetBlockStatus={handleSetBlockStatus}
							onToggleCheckable={handleToggleBlockCheckable}
							onAddTask={handleAddTask}
							onEditAssoc={openAssocPicker}
							onEditTaskAssoc={openTaskAssocPicker}
							onNestTask={openBlockPicker}
							onTaskGrab={onTaskGrab}
							dragTaskLine={taskDrag?.task.source.line}
							dropSlot={taskDrop ?? undefined}
							dragActive={taskDrag !== null}
						/>
					{/each}

					{#if draftRect}
						<div
							class="day-draft"
							style={`top: ${draftRect.top}px; height: ${draftRect.height}px;`}
						></div>
					{/if}
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

{#if blockPickerTarget && blockPickerAnchor}
	<BlockPicker
		options={blockPickerOptions}
		anchor={blockPickerAnchor}
		onPick={onPickBlock}
		onClose={closeBlockPicker}
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

{#if taskDrag}
	<!-- The floating ghost that follows the pointer during a task drag. -->
	<div
		class="task-ghost"
		use:portal
		style={`left: ${taskDrag.ghostX + 12}px; top: ${taskDrag.ghostY + 8}px;`}
	>
		{taskDrag.label}
	</div>
{/if}

<style>
	/* The drag ghost is portaled to <body>, so it needs a global selector to be
	   styled (component-scoped rules wouldn't reach it there). */
	:global(.task-ghost) {
		position: fixed;
		z-index: 1000;
		pointer-events: none;
		max-width: 220px;
		padding: 3px 8px;
		font-size: 12px;
		color: var(--text-normal);
		background: var(--background-primary);
		border: 1px solid var(--interactive-accent);
		border-radius: 5px;
		box-shadow: var(--shadow-s);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 0.95;
	}

	.day-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	/* A brief highlight on a block revealed from the Grid's badge click. `:global`
	   because the class is toggled on a TimelineBlock's root (a child component). */
	:global(.tl-block.reveal-flash) {
		animation: reveal-flash 1.2s ease-out;
	}
	@keyframes reveal-flash {
		0%,
		40% {
			box-shadow: 0 0 0 2px var(--interactive-accent);
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
	}

	.day-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px 6px;
		flex-shrink: 0;
	}

	/* ── Day navigation (arrows + date label + calendar) ── */
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

	/* When viewing today, tint the label with the accent so it's obvious. */
	.day-date.today {
		color: var(--interactive-accent);
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

	/* The inline calendar drops below the date label. */
	.calendar-popup {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 100;
	}

	.day-header-spacer {
		flex: 1;
	}

	.day-range-label {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/* ── Inline controls (Holos-style icon button + popover) ── */
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

	/* Some themes reset `svg { width: var(--icon-size) }`, and a CSS rule beats
	   the inline width/height attributes — collapsing the icon to 0. Pin the size
	   back explicitly and stop flex from shrinking it. */
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


	.day-scroll {
		flex: 1;
		overflow-y: auto;
	}

	.day-body {
		position: relative;
		display: flex;
	}

	/* ── Hour gutter ── */
	.day-gutter {
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

	/* ── Canvas ── */
	.day-canvas {
		position: relative;
		flex: 1;
		min-width: 0;
		cursor: crosshair;
	}

	/* Sketched rectangle shown while dragging out a new block. */
	.day-draft {
		position: absolute;
		left: 2px;
		width: calc(92% - 4px);
		border: 1px dashed var(--interactive-accent);
		border-radius: 5px;
		background: var(--interactive-accent);
		opacity: 0.18;
		pointer-events: none;
		z-index: 4;
	}

	.day-hour-line {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--background-modifier-border);
		opacity: 0.5;
	}

	.day-needle {
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--color-red, var(--interactive-accent));
		z-index: 3;
		pointer-events: none;
	}

	.day-needle::before {
		content: "";
		position: absolute;
		left: -3px;
		top: -3px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-red, var(--interactive-accent));
	}

	/* ── Unscheduled ── */
	.day-unscheduled {
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.us-header {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		user-select: none;
	}

	.us-header:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.us-chevron {
		transition: transform 0.15s;
		transform: rotate(-90deg);
		flex-shrink: 0;
	}

	.us-header.open .us-chevron {
		transform: rotate(0deg);
	}

	.us-count {
		font-size: 10px;
		font-weight: 400;
		color: var(--text-faint);
		margin-left: 2px;
	}

	/* ── Resurfacing (backlog nudges due today) ── */
	.day-resurfacing {
		border-bottom: 1px solid var(--background-modifier-border);
		padding: 2px 8px 6px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.rs-header {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 2px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		user-select: none;
	}
	.rs-header svg {
		flex-shrink: 0;
	}
	.rs-count {
		font-size: 10px;
		font-weight: 400;
		color: var(--text-faint);
		margin-left: 2px;
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
