<script lang="ts">
	// The Routines view — every recurring block and task in the routines file,
	// grouped by when it repeats (Daily, Weekdays, Weekends, day lists, monthly).
	//
	// Modelled on the Backlog view: a flat list per group, inline text editing,
	// an action bar woken from the row's right edge, the shared association
	// picker. Each row shows what the routine makes (a block with its time, a
	// task for the day's list, or a task homed in a block) and its association.
	//
	// The file is the source of truth and stays hand-editable: the view reads the
	// parsed file from the RoutinesStore and makes every change through one pure
	// routinesWriter edit (surgical — other lines are left byte-identical).

	import { Menu, Notice, type App } from "obsidian";
	import { onMount } from "svelte";
	import type { Association, Task } from "../../types";
	import type { KairosIndex, Resolver } from "../../index";
	import { navigateToAssociation } from "../../navigate";
	import { tooltip } from "../actions/tooltip";
	import { singleLine } from "../actions/autogrow";
	import TaskRow from "../task/Task.svelte";
	import RoutineGroupHeader from "./RoutineGroupHeader.svelte";
	import BlockPicker from "../timeline/BlockPicker.svelte";
	import type { BlockOption } from "../../blockOptions";
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import { createAssociation } from "../association/createAssociation";
	import { RuleModal } from "./RuleModal";
	import type { Readable } from "svelte/store";
	import type { RoutinesStore } from "../../routines/routinesStore";
	import type { OwnerActive } from "../../routines/owners";
	import { routineAssoc } from "../../routines/apply";
	import { todayISO } from "../../dayNote";
	import { formatClock, formatTimeRange, parseTimeRangeText } from "../../parser";
	import {
		type ParsedRoutines,
		type Routine,
		type TaskRoutine,
	} from "../../routines/routinesFile";
	import { blockGroupsOf, groupRoutines, type RoutineGroup } from "../../routines/routinesModel";
	import {
		addRoutine,
		draftOf,
		removeRoutine,
		scheduleInNewBlock,
		updateRoutine,
		type RoutineDraft,
	} from "../../routines/routinesWriter";
	import { parseRule, ruleKey, ruleSentence, type Rule } from "../../routines/rules";

	interface Props {
		app: App;
		index: KairosIndex;
		store: RoutinesStore;
		/** Whether a routine's project or domain is active on a date (owners.ts). */
		active$: Readable<OwnerActive>;
	}

	let { app, index, store, active$ }: Props = $props();

	// A routine whose project or domain isn't active today is paused (decision
	// 87): greyed here, and offered nowhere until its owner is active again.
	function isPaused(r: Routine): boolean {
		const assoc = routineAssoc(r);
		return assoc !== undefined && !$active$(assoc, todayISO());
	}

	let parsed = $state<ParsedRoutines>({ routines: [], problems: [] });
	let resolve = $state<Resolver>(() => ({ displayName: "", resolved: false }));
	const groups = $derived<RoutineGroup[]>(groupRoutines(parsed.routines));

	const DAILY = parseRule("daily")!;
	const NEW_TASK = "New routine";
	const NEW_BLOCK = "New block";

	// ── Writes ──

	async function update(r: Routine, draft: RoutineDraft) {
		await store.edit((md) => updateRoutine(md, r, draft));
	}

	async function remove(r: Routine) {
		await store.edit((md) => removeRoutine(md, r));
	}

	/**
	 * Add a routine; select its text to name it, as with a new task in the Grid.
	 * A task added from a block's "+" goes in that block (`home`).
	 */
	async function add(rule: Rule, kind: "task" | "block", home?: string) {
		const draft: RoutineDraft =
			kind === "block"
				? { kind, rule, title: NEW_BLOCK, time: { start: 540, end: 600 } }
				: { kind, rule, text: NEW_TASK, ...(home ? { home } : {}) };
		await store.edit((md) => addRoutine(md, draft));
	}

	function openAddMenu(rule: Rule, event: MouseEvent) {
		event.stopPropagation();
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Add task").setIcon("square-check").onClick(() => void add(rule, "task")));
		menu.addItem((i) => i.setTitle("Add block").setIcon("clock").onClick(() => void add(rule, "block")));
		menu.showAtMouseEvent(event);
	}

	function openNewGroup(event: MouseEvent) {
		event.stopPropagation();
		new RuleModal(app, {
			title: "New routine",
			description: "Choose when it repeats. You can name it next.",
			initial: DAILY,
			confirm: "Add",
			onConfirm: (rule) => void add(rule, "task"),
		}).open();
	}

	// ── Field edits ──

	function nameOf(r: Routine): string {
		return r.kind === "block" ? r.title : r.text;
	}

	function setName(r: Routine, value: string) {
		const name = singleLine(value).trim();
		if (name === "" || name === nameOf(r)) return;
		const draft = draftOf(r);
		void update(r, draft.kind === "block" ? { ...draft, title: name } : { ...draft, text: name });
	}

	function setTime(r: Routine, value: string) {
		if (r.kind !== "block") return;
		// Same rules as a block's time in a note, so an end at midnight ("24:00"
		// or "00:00") works.
		const parsed = parseTimeRangeText(value);
		if (!parsed.ok) {
			new Notice(parsed.error);
			return;
		}
		const { start, end } = parsed.range;
		if (start === r.time.start && end === r.time.end) return;
		void update(r, { ...(draftOf(r) as Extract<RoutineDraft, { kind: "block" }>), time: { start, end } });
	}

	function setHome(r: Routine, value: string) {
		if (r.kind !== "task") return;
		const home = singleLine(value).trim();
		if (home === (r.home ?? "")) return;
		const { home: _drop, homeAssoc: _assoc, ...rest } = draftOf(r) as Extract<RoutineDraft, { kind: "task" }>;
		// A task leaving a block keeps the association it showed.
		const assoc = r.assoc ?? r.inherited;
		void update(r, {
			...rest,
			...(assoc ? { assoc } : {}),
			...(home ? { home } : {}),
		});
	}

	function changeRule(r: Routine) {
		new RuleModal(app, {
			title: "Change when it repeats",
			description: `“${nameOf(r)}” repeats ${ruleSentence(r.rule)}.`,
			initial: r.rule,
			confirm: "Save",
			onConfirm: (rule) => {
				if (ruleKey(rule) !== ruleKey(r.rule)) void update(r, { ...draftOf(r), rule });
			},
		}).open();
	}

	function timeText(r: Routine): string {
		return r.kind === "block" ? formatTimeRange(r.time, " - ") : "";
	}

	// ── Association picker ──

	let pickerRoutine = $state<Routine | null>(null);
	let pickerAnchor = $state<DOMRect | null>(null);

	function shownAssoc(r: Routine): Association | undefined {
		return r.kind === "task" ? (r.assoc ?? r.inherited) : r.assoc;
	}

	function openAssoc(r: Routine, rect: DOMRect) {
		pickerRoutine = r;
		pickerAnchor = rect;
	}

	// ── Tasks, drawn with the shared task row ──

	/** A task routine as the task row the other views draw (a template: no status). */
	function asTask(t: TaskRoutine): Task {
		return {
			source: { path: store.filePath, line: t.line },
			text: t.text,
			status: " ",
			...(t.assoc ? { assoc: t.assoc } : {}),
		};
	}

	// ── Scheduling a task into a block ──
	// The same block picker the Grid uses to change a task's block: the rule
	// group's blocks (and homes), Unscheduled when the task is in a block, and
	// a last row that makes a new block for it. A task with no block shows a
	// visible "Schedule in a block" link under its text, so the way in is plain.

	let schedule = $state<{ task: TaskRoutine; routines: Routine[]; anchor: DOMRect } | null>(null);
	// The picker's options, and for each (by its stand-in block's line) the home
	// it means; "" is Unscheduled.
	const scheduleChoices = $derived.by(() => {
		const map = new Map<number, string>();
		if (!schedule) return { options: [] as BlockOption[], homes: map };
		const { task, routines } = schedule;
		const out: BlockOption[] = [];
		const seen = new Set<string>();
		const option = (title: string, home: string, time?: { start: number; end: number }): BlockOption => {
			const key = -(map.size + 1);
			map.set(key, home);
			return {
				block: { source: { path: store.filePath, line: key }, title, tasks: [], scheduled: time !== undefined, ...(time ? { time } : {}) },
				title,
				...(time ? { timeLabel: formatTimeRange(time) } : {}),
				start: time ? time.start : Number.MAX_SAFE_INTEGER,
				untimed: time === undefined,
			};
		};
		for (const r of routines) {
			if (r.kind !== "block" || seen.has(r.title) || r.title === task.home) continue;
			seen.add(r.title);
			out.push(option(r.title, r.title, r.time));
		}
		for (const r of routines) {
			if (r.kind !== "task" || !r.home || seen.has(r.home) || r.home === task.home) continue;
			seen.add(r.home);
			out.push(option(r.home, r.home));
		}
		if (task.home !== undefined) out.push(option("Unscheduled", ""));
		return { options: out.sort((a, b) => a.start - b.start), homes: map };
	});

	function openSchedule(t: TaskRoutine, routines: Routine[], anchor: DOMRect) {
		schedule = { task: t, routines, anchor };
	}

	function pickSchedule(o: BlockOption) {
		// Read the choice before closing: closing empties the options.
		const s = schedule;
		const home = scheduleChoices.homes.get(o.block.source.line);
		schedule = null;
		if (s && home !== undefined) setHome(s.task, home);
	}

	/**
	 * Make a block for a task and put the task in it, in one edit: named by
	 * what was typed, else the task's project or domain, else "New block", at
	 * 09:00–10:00 to adjust from the block's header.
	 */
	function createBlockFor(title: string) {
		const s = schedule;
		schedule = null;
		if (!s) return;
		const t = s.task;
		const assoc = t.assoc ?? t.inherited;
		const name = title || (assoc ? resolve(assoc).displayName || assoc.id : "") || NEW_BLOCK;
		void store.edit((md) => scheduleInNewBlock(md, t, name, { start: 540, end: 600 }));
	}

	function closeAssoc() {
		pickerRoutine = null;
		pickerAnchor = null;
	}

	function onPickAssoc(assoc: Association | null) {
		const r = pickerRoutine;
		closeAssoc();
		if (!r) return;
		const { assoc: _drop, ...rest } = draftOf(r);
		void update(r, assoc ? { ...rest, assoc } : rest);
	}


	onMount(() => {
		const unsubParsed = store.parsed$.subscribe((p) => (parsed = p));
		const unsubResolver = index.resolver().subscribe((r) => (resolve = r));
		return () => {
			unsubParsed();
			unsubResolver();
		};
	});
</script>

{#snippet taskRow(t: TaskRoutine, groupRoutines: Routine[])}
	{#snippet scheduleLink()}
		<!-- A task with no block: the way to give it one, in plain sight. Uses
		     the shared .kairos-meta classes, like the Grid's block badge. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="kairos-meta is-linked"
			title="Put it in a block, so it has a time"
			onclick={(e) => {
				e.stopPropagation();
				const row = (e.currentTarget as HTMLElement).closest(".k-task") ?? (e.currentTarget as HTMLElement);
				openSchedule(t, groupRoutines, row.getBoundingClientRect());
			}}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
			<span class="kairos-meta-label">Schedule in a block</span>
		</div>
	{/snippet}
	{@const assoc = t.assoc ?? t.inherited}
	{@const ra = assoc ? resolve(assoc) : undefined}
	{@const paused = isPaused(t)}
	<div class="routine-task" class:paused>
		<TaskRow
			task={asTask(t)}
			template
			lines={2}
			color={ra?.color}
			association={assoc}
			inherited={!t.assoc && t.inherited !== undefined}
			resolved={ra}
			onNavigate={() => assoc && navigateToAssociation(app, resolve(assoc))}
			onEditAssoc={(rect) => openAssoc(t, rect)}
			onNest={(rect) => openSchedule(t, groupRoutines, rect)}
			nestLabel={t.home === undefined ? "Schedule in a block" : "Move to another block"}
			meta={t.home === undefined ? scheduleLink : undefined}
			onRepeat={() => changeRule(t)}
			repeatLabel="Change when it repeats"
			trailing={paused ? "Paused" : undefined}
			onSetStatus={() => {}}
			onSetText={(_task, text) => setName(t, text)}
			onDelete={() => void remove(t)}
		/>
	</div>
{/snippet}

<div class="routines-view">
	<div class="routines-header">
		<span class="routines-title">Routines</span>
		<span class="routines-header-spacer"></span>
		<button class="routines-btn" title="Open {store.filePath} to edit it by hand" onclick={() => void store.openFile()}>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
			<span>Open file</span>
		</button>
		<button class="routines-btn" title="Add a routine" onclick={openNewGroup}>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
			<span>New routine</span>
		</button>
	</div>

	<div class="routines-scroll">
		{#if parsed.problems.length > 0}
			<div class="routines-problems">
				<div class="routines-problems-title">
					{parsed.problems.length === 1 ? "1 line" : `${parsed.problems.length} lines`} in {store.filePath} can't be used
				</div>
				<ul>
					{#each parsed.problems as p (p.line)}
						<li>Line {p.line + 1}: {p.message}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if groups.length === 0}
			<div class="routines-empty">
				<p>No routines yet.</p>
				<p>A routine is a block or task that comes back on a schedule — every weekday, Mondays and Wednesdays, the 1st of each month. Add one, or use <strong>Repeat…</strong> on any task.</p>
			</div>
		{/if}

		{#each groups as group (group.key)}
			<section class="routines-group">
				<header class="group-header">
					<span class="group-icon">
						<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
					</span>
					<span class="group-name">{group.name}</span>
					<span class="group-count">{group.routines.length}</span>
					<button class="add-btn" aria-label="Add a routine here" use:tooltip={"Add a routine here"} onclick={(e) => openAddMenu(group.rule, e)}>
						<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
					</button>
				</header>

				<!-- Laid out like a Grid cell grouped by block (decision 70): each
				     block's header, its tasks under it, Unscheduled last. A header's
				     "+" adds a task to that block. -->
				<div class="routine-blocks">
					{#each blockGroupsOf(group.routines) as bg (bg.key)}
						<div class="routine-block-group">
							{#if bg.block}
								{@const b = bg.block}
								{@const ba = b.assoc ? resolve(b.assoc) : undefined}
								<RoutineGroupHeader
									kind="block"
									title={b.title}
									start={formatClock(b.time.start)}
									timeText={timeText(b)}
									assocLabel={b.assoc ? ba?.displayName || b.assoc.id : undefined}
									assocColor={ba?.color}
									paused={isPaused(b)}
									onAdd={() => void add(group.rule, "task", b.title)}
									onRename={(title) => setName(b, title)}
									onSetTime={(text) => setTime(b, text)}
									onChangeRule={() => changeRule(b)}
									onEditAssoc={(rect) => openAssoc(b, rect)}
									onDelete={() => void remove(b)}
								/>
							{:else}
								<RoutineGroupHeader
									kind={bg.unscheduled ? "unscheduled" : "home"}
									title={bg.home ?? "Unscheduled"}
									onAdd={() => void add(group.rule, "task", bg.home)}
								/>
							{/if}
							{#each bg.tasks as t (t.line)}
								{@render taskRow(t, group.routines)}
							{/each}
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</div>

{#if schedule}
	<BlockPicker
		options={scheduleChoices.options}
		anchor={schedule.anchor}
		placeholder="Schedule in a block…"
		onPick={pickSchedule}
		onCreate={createBlockFor}
		onClose={() => (schedule = null)}
	/>
{/if}

{#if pickerRoutine && pickerAnchor}
	<AssociationPicker
		options={index.associationOptions()}
		create={(kind, name) => createAssociation(index, kind, name)}
		current={shownAssoc(pickerRoutine)}
		anchor={pickerAnchor}
		onPick={onPickAssoc}
		onClose={closeAssoc}
	/>
{/if}

<style>
	.routines-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.routines-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 12px 8px;
		flex-shrink: 0;
	}
	.routines-title {
		font-size: 14px;
		font-weight: 700;
		color: var(--text-normal);
	}
	.routines-header-spacer {
		flex: 1;
	}
	.routines-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--background-primary-alt);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 4px 8px;
		cursor: pointer;
	}
	.routines-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.routines-scroll {
		flex: 1;
		overflow: auto;
		padding: 0 12px 16px;
	}
	.routines-problems {
		margin: 0 4px 12px;
		padding: 8px 10px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-error, var(--text-error));
		font-size: 12px;
		color: var(--text-muted);
	}
	.routines-problems-title {
		font-weight: 600;
		color: var(--text-error);
		margin-bottom: 4px;
	}
	.routines-problems ul {
		margin: 0;
		padding-left: 18px;
	}
	.routines-empty {
		font-size: 13px;
		color: var(--text-muted);
		padding: 8px 4px;
	}
	.routines-group {
		margin-bottom: 14px;
	}
	.group-header {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 4px;
		position: sticky;
		top: 0;
		background: var(--background-primary);
		z-index: 1;
	}
	.group-icon {
		display: flex;
		color: var(--text-muted);
	}
	.group-name {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--text-normal);
	}
	.group-count {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.add-btn {
		margin-left: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 22px;
		width: 22px;
		min-width: min-content;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary-alt);
		color: var(--text-muted);
		cursor: pointer;
	}
	.add-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	/* Block groups, spaced like the Grid's (GridCell .grid-cell-block-group). */
	.routine-blocks {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 0 4px;
	}
	.routine-block-group {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.routine-task {
		min-width: 0;
		border-radius: var(--radius-s);
	}
	.routine-task.paused {
		opacity: 0.5;
	}
</style>
