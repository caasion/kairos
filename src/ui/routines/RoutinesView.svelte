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
	import type { Association } from "../../types";
	import type { KairosIndex, Resolver } from "../../index";
	import { navigateToAssociation } from "../../navigate";
	import { actionZone } from "../actions/actionZone";
	import { tooltip } from "../actions/tooltip";
	import { autogrow, singleLine } from "../actions/autogrow";
	import AssociationPicker from "../association/AssociationPicker.svelte";
	import { RuleModal } from "./RuleModal";
	import type { Readable } from "svelte/store";
	import type { RoutinesStore } from "../../routines/routinesStore";
	import type { OwnerActive } from "../../routines/owners";
	import { routineAssoc } from "../../routines/apply";
	import { todayISO } from "../../dayNote";
	import { parseRoutines, type ParsedRoutines, type Routine } from "../../routines/routinesFile";
	import { groupRoutines, type RoutineGroup } from "../../routines/routinesModel";
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

	/** Add a routine, then drop straight into editing its text. */
	async function add(rule: Rule, kind: "task" | "block") {
		const draft: RoutineDraft =
			kind === "block"
				? { kind, rule, title: NEW_BLOCK, time: { start: 540, end: 600 }, checkable: false }
				: { kind, rule, text: NEW_TASK };
		let written = "";
		const ok = await store.edit((md) => (written = addRoutine(md, draft)));
		if (!ok) return;
		// The new routine is the last one with that name in its rule's group.
		const name = kind === "block" ? NEW_BLOCK : NEW_TASK;
		const added = parseRoutines(written)
			.routines.filter((r) => ruleKey(r.rule) === ruleKey(rule) && nameOf(r) === name)
			.pop();
		if (added) editing = { line: added.line, field: "text" };
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

	// ── Inline editing ──

	type Field = "text" | "time" | "home";
	let editing = $state<{ line: number; field: Field } | null>(null);

	function isEditing(r: Routine, field: Field): boolean {
		return editing?.line === r.line && editing.field === field;
	}

	function startEdit(r: Routine, field: Field, event?: MouseEvent) {
		event?.stopPropagation();
		editing = { line: r.line, field };
	}

	function finishEdit(r: Routine, field: Field, value: string) {
		if (!isEditing(r, field)) return;
		editing = null;
		if (field === "text") setName(r, value);
		else if (field === "time") setTime(r, value);
		else setHome(r, value);
	}

	function editKeys(event: KeyboardEvent & { currentTarget: HTMLInputElement | HTMLTextAreaElement }, original: string) {
		if (event.key === "Enter") {
			event.preventDefault();
			event.currentTarget.blur();
		} else if (event.key === "Escape") {
			event.currentTarget.value = original;
			event.currentTarget.blur();
		}
	}

	function formatTime(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}

	function homeOf(r: Routine): string {
		return r.kind === "task" ? (r.home ?? "") : "";
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

	function openAssoc(r: Routine, event: MouseEvent) {
		event.stopPropagation();
		pickerRoutine = r;
		pickerAnchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
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

	function onNavigate(assoc: Association, event: MouseEvent) {
		if (!(event.ctrlKey || event.metaKey)) return;
		event.stopPropagation();
		navigateToAssociation(app, resolve(assoc));
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

				<ul class="routine-list">
					{#each group.routines as r (r.line)}
						{@const assoc = shownAssoc(r)}
						{@const ra = assoc ? resolve(assoc) : undefined}
						{@const paused = isPaused(r)}
						<li
							class="routine-row"
							class:is-homed={r.kind === "task" && r.home !== undefined}
							class:paused
							class:linked={hovered !== null && link(r) === hovered}
							class:flash={flashLine === r.line}
							data-routine-line={r.line}
							onpointerenter={() => (hovered = link(r))}
							onpointerleave={() => (hovered = null)}
							use:actionZone={{ anchor: "right", layout: "stack" }}
						>
							<div class="routine-main">
								<span class="routine-kind" title={r.kind === "block" ? (r.checkable ? "Checkable block" : "Block") : "Task"}>
									{#if r.kind === "block"}
										<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
									{:else}
										<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="3"/></svg>
									{/if}
								</span>

								{#if isEditing(r, "text")}
									<!-- svelte-ignore a11y_autofocus -->
									<textarea
										class="routine-input kairos-inline-input"
										rows="1"
										value={nameOf(r)}
										autofocus
										use:autogrow
										onfocus={(e) => e.currentTarget.select()}
										onblur={(e) => finishEdit(r, "text", e.currentTarget.value)}
										onkeydown={(e) => editKeys(e, nameOf(r))}
									></textarea>
								{:else}
									<button class="routine-text" onclick={(e) => startEdit(r, "text", e)}>
										<span class="routine-text-clamp">{nameOf(r)}</span>
									</button>
								{/if}
								{#if paused}
									<span class="routine-paused" use:tooltip={"Paused: its project or domain isn't active. It comes back when that's active again."}>Paused</span>
								{/if}
							</div>

							<div class="routine-actions kairos-action-bar">
								<button class="routine-action" aria-label="Change when it repeats" use:tooltip={"Change when it repeats"} onclick={(e) => { e.stopPropagation(); changeRule(r); }}>
									<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
								</button>
								<button class="routine-action" aria-label={assoc ? "Change association" : "Associate with a project or domain"} use:tooltip={assoc ? "Change association" : "Associate with a project or domain"} onclick={(e) => openAssoc(r, e)}>
									<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
								</button>
								{#if r.kind === "block"}
									<button class="routine-action" aria-label={r.checkable ? "Make it a plain block" : "Make it checkable"} use:tooltip={r.checkable ? "Make it a plain block" : "Make it checkable"} onclick={(e) => { e.stopPropagation(); toggleCheckable(r); }}>
										<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="3"/><path d="m9 12 2 2 4-4"/></svg>
									</button>
								{:else}
									<button class="routine-action" aria-label="Choose its block" use:tooltip={"Choose its block"} onclick={(e) => startEdit(r, "home", e)}>
										<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 12H9"/><path d="m9 12 3-3"/><path d="m9 12 3 3"/></svg>
									</button>
								{/if}
								<button class="routine-action routine-action-danger" aria-label="Delete routine" use:tooltip={"Delete routine"} onclick={(e) => { e.stopPropagation(); void remove(r); }}>
									<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
								</button>
							</div>

							<div class="kairos-meta-row is-indented">
								{#if r.kind === "block"}
									{#if isEditing(r, "time")}
										<!-- svelte-ignore a11y_autofocus -->
										<input
											class="routine-meta-input kairos-inline-input"
											value={timeText(r)}
											placeholder="HH:MM - HH:MM"
											autofocus
											onfocus={(e) => e.currentTarget.select()}
											onblur={(e) => finishEdit(r, "time", e.currentTarget.value)}
											onkeydown={(e) => editKeys(e, timeText(r))}
										/>
									{:else}
										<button class="routine-meta kairos-meta is-linked" title="Change the time" onclick={(e) => startEdit(r, "time", e)}>
											<span class="kairos-meta-label">{timeText(r)}</span>
										</button>
									{/if}
									{#if r.checkable}
										<span class="kairos-meta"><span class="kairos-meta-label">Checkable</span></span>
									{/if}
								{:else if isEditing(r, "home")}
									<span class="kairos-meta"><span class="kairos-meta-label">In</span></span>
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class="routine-meta-input kairos-inline-input"
										value={homeOf(r)}
										placeholder="Block title, or empty for Unscheduled"
										autofocus
										onblur={(e) => finishEdit(r, "home", e.currentTarget.value)}
										onkeydown={(e) => editKeys(e, homeOf(r))}
									/>
								{:else}
									<button class="routine-meta kairos-meta is-linked" title="Choose which block it goes in" onclick={(e) => startEdit(r, "home", e)}>
										<span class="kairos-meta-label">{r.home !== undefined ? `In ${r.home}` : "Unscheduled"}</span>
									</button>
								{/if}

								{#if assoc}
									<span class="kairos-meta-dot"></span>
									<button
										class="routine-meta kairos-meta"
										class:is-inherited={r.kind === "task" && !r.assoc}
										class:is-linked={ra?.resolved}
										style={ra?.color ? `color: ${ra.color};` : undefined}
										title="Change association (ctrl+click to open)"
										onclick={(e) => {
											onNavigate(assoc, e);
											if (!(e.ctrlKey || e.metaKey)) openAssoc(r, e);
										}}
									>
										<span class="kairos-meta-label">{ra?.displayName || assoc.id}</span>
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
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
	.routine-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.routine-row {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 5px 8px;
		border-radius: 7px;
		position: relative;
		--kairos-meta-indent: 21px;
	}
	/* A task homed in a block sits a step in, under its block. */
	.routine-row.is-homed {
		margin-left: 16px;
	}
	.routine-row:hover,
	.routine-row.linked {
		background: var(--background-modifier-hover);
	}
	.routine-row.flash {
		background: color-mix(in srgb, var(--interactive-accent) 15%, transparent);
		transition: background 300ms ease;
	}
	.routine-row.paused .routine-kind,
	.routine-row.paused .routine-text,
	.routine-row.paused .routine-meta {
		opacity: 0.5;
	}
	.routine-paused {
		flex-shrink: 0;
		margin-top: 2px;
		padding: 0 6px;
		border-radius: 8px;
		font-size: 10px;
		line-height: 16px;
		color: var(--text-muted);
		background: var(--background-modifier-hover);
	}
	.routine-main {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		min-width: 0;
	}
	.routine-kind {
		display: flex;
		color: var(--text-faint);
		flex-shrink: 0;
		margin-top: 2px;
	}
	.routine-text {
		display: block;
		flex: 1;
		min-width: 0;
		font-size: 13px;
		line-height: 1.4;
		height: min-content;
		color: var(--text-normal);
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
		margin: 0;
		cursor: text;
		text-align: left;
		white-space: normal;
		overflow: hidden;
	}
	.routine-text-clamp {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.routine-input {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		line-height: 1.4;
		font-family: inherit;
		color: var(--text-normal);
		background: transparent;
		border: none;
		padding: 0;
		margin: 0;
	}
	.routine-meta {
		align-self: flex-start;
		padding: 0;
		margin: 0;
		border: none;
		box-shadow: none;
		background: transparent;
		height: min-content;
	}
	.routine-meta-input {
		font-size: var(--kairos-meta-font-size, 10px);
		min-width: 0;
		flex: 1;
		padding: 0;
		background: transparent;
		border: none;
	}
	.routine-actions {
		position: absolute;
		top: 50%;
		right: 8px;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		padding: 2px;
		border-radius: 4px;
		background: var(--background-primary);
	}
	.routine-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 4px;
		box-shadow: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.routine-action:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	/* Stack layout (styles.css): delete takes the corner cell. */
	.routine-action-danger {
		order: -1;
	}
	.routine-action-danger:hover {
		color: var(--text-error, #e05555);
	}
</style>
