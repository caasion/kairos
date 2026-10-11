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
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import { RuleModal } from "./RuleModal";
	import type { Readable } from "svelte/store";
	import type { RoutinesStore } from "../../routines/routinesStore";
	import type { OwnerActive } from "../../routines/owners";
	import { routineAssoc } from "../../routines/apply";
	import { todayISO } from "../../dayNote";
	import {
		type ParsedRoutines,
		type Routine,
		type TaskRoutine,
	} from "../../routines/routinesFile";
	import { blockGroupsOf, groupRoutines, type RoutineGroup } from "../../routines/routinesModel";
	import { routineLink } from "../../routines/templateWeek";
	import TemplateWeek from "./TemplateWeek.svelte";
	import {
		addRoutine,
		draftOf,
		removeRoutine,
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

	// ── The list beside the template week ──
	// Pointing at a routine in either lights it in both: a block on every day it
	// repeats, with the tasks homed in it (routineLink). Selecting one in the
	// week scrolls the list to it, since the list is where routines are edited.
	let hovered = $state<number | null>(null);
	const link = $derived(routineLink(parsed.routines));
	let listEl = $state<HTMLDivElement>();
	let flashLine = $state<number | null>(null);
	let flashTimer: number | undefined;
	function revealInList(r: Routine) {
		const row = listEl?.querySelector<HTMLElement>(`[data-routine-line="${r.line}"]`);
		row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		flashLine = r.line;
		window.clearTimeout(flashTimer);
		flashTimer = window.setTimeout(() => (flashLine = null), 1200);
	}
	$effect(() => () => window.clearTimeout(flashTimer));

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
				? { kind, rule, title: NEW_BLOCK, time: { start: 540, end: 600 }, checkable: false }
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

	const TIME = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/;

	function setTime(r: Routine, value: string) {
		if (r.kind !== "block") return;
		const m = TIME.exec(value.trim());
		const start = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
		const end = m ? Number(m[3]) * 60 + Number(m[4]) : NaN;
		if (!m || !(start >= 0 && end <= 24 * 60 && end > start) || Number(m[2]) > 59 || Number(m[4]) > 59) {
			new Notice("Write the time like 09:00 - 10:00, ending after it starts.");
			return;
		}
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

	function toggleCheckable(r: Routine) {
		if (r.kind !== "block") return;
		void update(r, { ...(draftOf(r) as Extract<RoutineDraft, { kind: "block" }>), checkable: !r.checkable });
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

	function formatTime(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}

	function timeText(r: Routine): string {
		return r.kind === "block" ? `${formatTime(r.time.start)} - ${formatTime(r.time.end)}` : "";
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

	/** Move a task to another block of its rule group, or to Unscheduled. */
	function openMoveMenu(t: TaskRoutine, routines: Routine[], rect: DOMRect) {
		const menu = new Menu();
		const homes = new Set<string>();
		for (const r of routines) {
			if (r.kind === "block") homes.add(r.title);
			else if (r.home) homes.add(r.home);
		}
		for (const home of homes) {
			menu.addItem((i) =>
				i
					.setTitle(home)
					.setChecked(t.home === home)
					.onClick(() => setHome(t, home)),
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Unscheduled")
				.setChecked(t.home === undefined)
				.onClick(() => setHome(t, "")),
		);
		menu.showAtPosition({ x: rect.left + 24, y: rect.bottom });
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
	{@const assoc = t.assoc ?? t.inherited}
	{@const ra = assoc ? resolve(assoc) : undefined}
	{@const paused = isPaused(t)}
	<div
		class="routine-task"
		class:paused
		class:flash={flashLine === t.line}
		data-routine-line={t.line}
	>
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
			onNest={(rect) => openMoveMenu(t, groupRoutines, rect)}
			nestLabel="Move to another block"
			onRepeat={() => changeRule(t)}
			repeatLabel="Change when it repeats"
			trailing={paused ? "Paused" : undefined}
			highlight={hovered !== null && link(t) === hovered ? "block" : null}
			onHoverChange={(on) => (hovered = on ? link(t) : null)}
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

	<div class="routines-body">
	<div class="routines-scroll" bind:this={listEl}>
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
									start={formatTime(b.time.start)}
									timeText={timeText(b)}
									checkable={b.checkable}
									assocLabel={b.assoc ? ba?.displayName || b.assoc.id : undefined}
									assocColor={ba?.color}
									color={ba?.color}
									paused={isPaused(b)}
									linked={hovered !== null && link(b) === hovered}
									flash={flashLine === b.line}
									line={b.line}
									onAdd={() => void add(group.rule, "task", b.title)}
									onHover={(on) => (hovered = on ? link(b) : null)}
									onRename={(title) => setName(b, title)}
									onSetTime={(text) => setTime(b, text)}
									onChangeRule={() => changeRule(b)}
									onEditAssoc={(rect) => openAssoc(b, rect)}
									onToggleCheckable={() => toggleCheckable(b)}
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

	<!-- The template week: what the routines add up to, read-only. Edit in the
	     list; pointing at a routine in either lights it in both. -->
	<div class="routines-week">
		<TemplateWeek
			routines={parsed.routines}
			{resolve}
			{hovered}
			{link}
			{isPaused}
			onHover={(key) => (hovered = key)}
			onSelect={revealInList}
		/>
	</div>
	</div>
</div>

{#if pickerRoutine && pickerAnchor}
	<AssociationPicker
		options={index.associationOptions()}
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
	/* List and template week side by side; stacked when the view is narrow. */
	.routines-view {
		container-type: inline-size;
	}
	.routines-body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.routines-scroll {
		flex: 1 1 0;
		min-width: 0;
		overflow: auto;
		padding: 0 12px 16px;
	}
	.routines-week {
		flex: 1.3 1 0;
		min-width: 0;
		overflow: auto;
		padding: 0 12px 16px 4px;
	}
	@container (max-width: 640px) {
		.routines-body {
			flex-direction: column;
			overflow: auto;
		}
		.routines-scroll,
		.routines-week {
			flex: none;
			overflow: visible;
		}
		.routines-week {
			padding: 8px 12px 16px;
			border-top: 1px solid var(--background-modifier-border);
		}
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
	.routine-task.flash {
		background: color-mix(in srgb, var(--interactive-accent) 15%, transparent);
		transition: background 300ms ease;
	}
</style>
