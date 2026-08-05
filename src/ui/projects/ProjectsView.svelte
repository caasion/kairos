<script lang="ts">
	// The Projects & Domains page (spec §5). One list: durable domains as top-level
	// rows, their projects nested beneath, plus an "Unassigned" group for projects
	// with no domain. A status filter (Active / Inactive / Archived) sits in the
	// header; archived is hidden by default.
	//
	// Per-row inline edits route through projectActions → the index (never markdown
	// directly): color swatch + reorder (domains), rename, status, and domain link
	// (projects). Ctrl/⌘-click a row's name opens its markdown file. A "backlog"
	// button opens the Backlog view filtered to that domain (+ child projects) or
	// that single project — the settled rule.
	//
	// Domains are durable: they never archive, so the status control offers only
	// active/inactive for them and the Archived filter shows projects only.

	import type { App } from "obsidian";
	import { Menu, TFile } from "obsidian";
	import { onMount } from "svelte";
	import type { Unsubscriber } from "svelte/store";
	import type {
		Domain,
		ISODate,
		LifecycleState,
		Project,
	} from "../../types";
	import type { KairosIndex, ProjectsDomains } from "../../index";
	import {
		renameDomain,
		renameProject,
		setDomainColor,
		setDomainDescription,
		setDomainOrder,
		setDomainStatus,
		setProjectDescription,
		setProjectDomain,
		setProjectStatus,
	} from "../../projectActions";
	import { dateFromISO, isoFromDate, todayISO } from "../../dayNote";
	import { effectiveStatus } from "../../projectFile";
	import { DomainReorderModal } from "./DomainReorderModal";
	import { ConfirmModal, PromptModal } from "./modals";
	import Datepicker from "../components/Datepicker.svelte";
	import Portal from "../components/Portal.svelte";

	interface Props {
		app: App;
		index: KairosIndex;
		openBacklogFiltered: (names: string[], label: string) => void;
	}

	let { app, index, openBacklogFiltered }: Props = $props();

	// ── The feed ──
	let feed = $state<ProjectsDomains>({
		domains: [],
		projectsByDomain: new Map(),
		orphans: [],
	});

	// ── Status filter (archived hidden by default) ──
	type Filter = "active" | "inactive" | "archived";
	let filter = $state<Set<Filter>>(new Set<Filter>(["active", "inactive"]));

	function toggleFilter(f: Filter) {
		const next = new Set(filter);
		if (next.has(f)) next.delete(f);
		else next.add(f);
		// Never let all filters off — that would hide everything with no way back.
		if (next.size === 0) next.add(f);
		filter = next;
	}

	/** An entity's lifecycle state in effect today (future-dated records don't
	    take effect until their date), or active when none applies. */
	function statusOf(e: Project | Domain): LifecycleState {
		return effectiveStatus(e.history, todayISO());
	}

	function passesFilter(e: Project | Domain): boolean {
		return filter.has(statusOf(e) as Filter);
	}

	// ── Rows: domains (filtered, keeping any that still have visible children) ──
	interface DomainRow {
		domain: Domain;
		projects: Project[];
	}

	const domainRows = $derived.by<DomainRow[]>(() => {
		const rows: DomainRow[] = [];
		for (const domain of feed.domains) {
			const projects = (feed.projectsByDomain.get(domain.id) ?? []).filter(
				passesFilter,
			);
			// Show a domain if it itself passes, or it still has visible children.
			if (passesFilter(domain) || projects.length > 0) {
				rows.push({ domain, projects });
			}
		}
		return rows;
	});

	const orphanRows = $derived(feed.orphans.filter(passesFilter));

	// ── Editing state ──
	let editingName = $state<string | null>(null); // source.path of the row being renamed

	// ── Rename ──
	function startRename(e: Project | Domain) {
		editingName = e.source.path;
	}

	function finishRename(e: Project | Domain, isDomain: boolean, value: string) {
		editingName = null;
		const next = value.trim();
		if (next === "" || next === e.name) return;
		const clash = index.nameCollision(next, e);
		if (clash) {
			// A collision would make the name-match model ambiguous (spec §4.4).
			// eslint-disable-next-line no-alert
			window.alert(
				`"${next}" collides with "${clash}". Names and aliases must be unique.`,
			);
			return;
		}
		if (isDomain) void renameDomain(index, e as Domain, next);
		else void renameProject(index, e as Project, next);
	}

	// ── Status ──
	// A single click toggles between active and its opposite (spec §4.4: additive
	// history, always stamped today). Projects remember the last non-active state
	// they were in so a project that was archived toggles back to archived, not
	// inactive; domains only ever swing active⇄inactive (they can't archive).
	// Reaching a *specific* state at a *specific* date is the history overlay's job.
	function lastNonActive(e: Project | Domain): LifecycleState {
		for (let i = e.history.length - 1; i >= 0; i--) {
			const s = e.history[i]?.status;
			if (s && s !== "active") return s;
		}
		return "inactive";
	}
	function toggleStatus(e: Project | Domain, isDomain: boolean) {
		const next: LifecycleState =
			statusOf(e) === "active" ? (isDomain ? "inactive" : lastNonActive(e)) : "active";
		if (isDomain) setDomainStatus(index, e as Domain, todayISO(), next);
		else setProjectStatus(index, e as Project, todayISO(), next);
	}

	// ── Status history overlay (in-view portal) ──
	// Read-only view of the append-only history, plus the ability to add a new
	// record at a chosen date. We never edit or delete past records: an out-of-
	// order date later than an existing one would break the "latest = current"
	// rule (spec §4.4). Power users can hand-edit the frontmatter JSON if needed.
	let historyRow = $state<Project | Domain | null>(null);
	let historyIsDomain = $state(false);
	let historyDate = $state<Date>(dateFromISO(todayISO()));
	let historyPickDate = $state(false);

	function openHistory(e: Project | Domain) {
		historyRow = e;
		historyIsDomain = feed.domains.some((d) => d.source.path === e.source.path);
		historyDate = dateFromISO(todayISO());
		historyPickDate = false;
	}
	function closeHistory() {
		historyRow = null;
		historyPickDate = false;
	}
	function addStatusRecord(status: LifecycleState) {
		const e = historyRow;
		if (!e) return;
		const date = isoFromDate(historyDate);
		closeHistory();
		if (historyIsDomain) setDomainStatus(index, e as Domain, date, status);
		else setProjectStatus(index, e as Project, date, status);
	}

	// The states offered when adding a record: domains can't archive.
	const historyStates = $derived<LifecycleState[]>(
		historyIsDomain ? ["active", "inactive"] : ["active", "inactive", "archived"],
	);

	// ── Domain color ──
	function pickColor(domain: Domain, color: string) {
		setDomainColor(index, domain, color);
	}

	// ── Domain reorder (global, via a modal) ──
	function openReorder() {
		new DomainReorderModal(app, feed.domains, (ordered) => {
			// Persist the new global order: renumber sequentially so gaps/dupes clear.
			ordered.forEach((d, i) => {
				if (d.order !== i) setDomainOrder(index, d, i);
			});
		}).open();
	}

	// ── Domain link (project → domain) ──
	// A submenu listing every domain (durable, so none are archived) plus "None"
	// to clear. The project stores the domain's stable id; the current selection
	// is shown checked.
	function addDomainPickerItems(submenu: Menu, project: Project) {
		submenu.addItem((item) =>
			item
				.setTitle("None")
				.setChecked(!project.domain)
				.onClick(() => pickDomain(project, undefined)),
		);
		for (const d of feed.domains) {
			submenu.addItem((item) =>
				item
					.setTitle(d.name)
					.setChecked(project.domain === d.id)
					.onClick(() => pickDomain(project, d.id)),
			);
		}
	}
	function pickDomain(project: Project, domainId: string | undefined) {
		if (project.domain === domainId) return;
		setProjectDomain(index, project, domainId);
	}

	// ── Context menus (spec §5): the destructive / less-frequent actions live here
	// rather than as always-visible icons, keeping the rows clean. ──
	function openDomainMenu(domain: Domain, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Rename")
				.setIcon("pencil")
				.onClick(() => startRename(domain)),
		);
		menu.addItem((item) =>
			item
				.setTitle(domain.description ? "Edit description" : "Add description")
				.setIcon("text")
				.onClick(() => editDescription(domain, true)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Add project")
				.setIcon("plus")
				.onClick(() => createProject(domain.id)),
		);
		menu.addSeparator();
		// Domains never archive: the only status swing is active⇄inactive.
		menu.addItem((item) =>
			item
				.setTitle(
					statusOf(domain) === "active" ? "Set inactive" : "Set active",
				)
				.setIcon("circle-dot")
				.onClick(() => toggleStatus(domain, true)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Status history…")
				.setIcon("history")
				.onClick(() => openHistory(domain)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => deleteDomain(domain)),
		);
		menu.showAtMouseEvent(e);
	}

	function openProjectMenu(project: Project, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Rename")
				.setIcon("pencil")
				.onClick(() => startRename(project)),
		);
		menu.addItem((item) =>
			item
				.setTitle(project.description ? "Edit description" : "Add description")
				.setIcon("text")
				.onClick(() => editDescription(project, false)),
		);
		// Change domain — a nested submenu of every domain (+ None).
		menu.addItem((item) => {
			item.setTitle("Change domain").setIcon("panel-top");
			// @ts-expect-error setSubmenu is available on Obsidian's MenuItem.
			addDomainPickerItems(item.setSubmenu(), project);
		});
		menu.addSeparator();
		// The toggle target mirrors toggleStatus: an active project drops to the
		// last non-active state it held (inactive by default), else back to active.
		menu.addItem((item) =>
			item
				.setTitle(
					statusOf(project) === "active"
						? `Set ${STATUS_LABEL[lastNonActive(project)].toLowerCase()}`
						: "Set active",
				)
				.setIcon("circle-dot")
				.onClick(() => toggleStatus(project, false)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Status history…")
				.setIcon("history")
				.onClick(() => openHistory(project)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => deleteProject(project)),
		);
		menu.showAtMouseEvent(e);
	}

	// ── Open the markdown file (ctrl/⌘-click) ──
	function openFile(e: Project | Domain, ev: MouseEvent) {
		if (!(ev.ctrlKey || ev.metaKey)) return;
		ev.preventDefault();
		ev.stopPropagation();
		const file = app.vault.getAbstractFileByPath(e.source.path);
		if (file instanceof TFile) void app.workspace.getLeaf("tab").openFile(file);
	}

	// ── Backlog navigation (spec §5, settled rule) ──
	function backlogForDomain(row: DomainRow) {
		// Domain button → the domain + all its (visible) child projects.
		const names = [row.domain.name, ...row.projects.map((p) => p.name)];
		openBacklogFiltered(names, row.domain.name);
	}
	function backlogForProject(project: Project) {
		openBacklogFiltered([project.name], project.name);
	}

	// ── Create ── (native modals — Obsidian's sandbox disables window.prompt)
	function createDomain() {
		new PromptModal(app, {
			title: "New domain",
			placeholder: "Domain name",
			cta: "Create",
			onSubmit: (name) => {
				const clash = index.nameCollision(name);
				if (clash) {
					window.alert(`"${name}" collides with "${clash}".`);
					return;
				}
				void index.createDomain(name);
			},
		}).open();
	}
	function createProject(domainId?: string) {
		new PromptModal(app, {
			title: "New project",
			placeholder: "Project name",
			cta: "Create",
			onSubmit: (name) => {
				const clash = index.nameCollision(name);
				if (clash) {
					window.alert(`"${name}" collides with "${clash}".`);
					return;
				}
				void index.createProject(name, domainId);
			},
		}).open();
	}

	// ── Description (either kind) — edited via a native prompt modal. ──
	function editDescription(e: Project | Domain, isDomain: boolean) {
		new PromptModal(app, {
			title: `Description — ${e.name}`,
			placeholder: "A short blurb",
			initial: e.description,
			cta: "Save",
			allowEmpty: true,
			onSubmit: (desc) => {
				if (isDomain) setDomainDescription(index, e as Domain, desc);
				else setProjectDescription(index, e as Project, desc);
			},
		}).open();
	}

	// ── Delete (spec §4.4 — allowed, with a dangling-reference warning) ──
	// Obsidian's sandbox disables window.confirm, so both route through a native
	// ConfirmModal.
	function deleteProject(project: Project) {
		new ConfirmModal(app, {
			title: `Delete project "${project.name}"?`,
			message:
				`Archiving is usually better. Any daily-note tags naming this ` +
				`project (including its aliases) will become dangling references — ` +
				`they'll still show by name but lose their color.`,
			cta: "Delete",
			danger: true,
			onConfirm: () => void index.deleteProject(project.name),
		}).open();
	}
	function deleteDomain(domain: Domain) {
		new ConfirmModal(app, {
			title: `Delete domain "${domain.name}"?`,
			message:
				`Archiving is usually better. Any daily-note tags naming this ` +
				`domain (including its aliases), and projects linked to it, will ` +
				`become dangling references.`,
			cta: "Delete",
			danger: true,
			onConfirm: () => void index.deleteDomain(domain.name),
		}).open();
	}

	function isEditing(e: Project | Domain): boolean {
		return editingName === e.source.path;
	}

	function handleClickOutside() {
		editingName = null;
		closeHistory();
	}

	function formatDate(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	onMount(() => {
		const unsub: Unsubscriber = index.projectsDomains().subscribe((f) => {
			feed = f;
		});
		return () => unsub();
	});

	const STATUS_LABEL: Record<LifecycleState, string> = {
		active: "Active",
		inactive: "Inactive",
		archived: "Archived",
	};
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="projects-view" onclick={handleClickOutside}>
	<div class="pv-header">
		<span class="pv-title">Projects &amp; domains</span>
		<span class="pv-spacer"></span>

		<div class="filter-group">
			{#each ["active", "inactive", "archived"] as const as f}
				<button
					class="filter-btn"
					class:on={filter.has(f)}
					onclick={(e) => {
						e.stopPropagation();
						toggleFilter(f);
					}}>{STATUS_LABEL[f]}</button
				>
			{/each}
		</div>

		<!-- Reorder domains — global order, so it opens a modal for the whole list
		     (there are no per-row up/down arrows; projects aren't reorderable). -->
		<button
			class="add-btn"
			title="Reorder domains"
			onclick={(e) => { e.stopPropagation(); openReorder(); }}
			aria-label="Reorder domains"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/></svg>
		</button>

		<button
			class="add-btn"
			title="New domain"
			onclick={(e) => {
				e.stopPropagation();
				createDomain();
			}}
			aria-label="New domain"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
		</button>
	</div>

	<div class="pv-scroll">
		{#each domainRows as row (row.domain.id)}
			<section class="domain-group">
				<!-- The whole header is one interactive object: hovering highlights the
				     full line, right-click opens the context menu (change status, add
				     project, delete, …). Only color and backlog stay as inline icons. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<header
					class="domain-header"
					class:dim={statusOf(row.domain) !== "active"}
					oncontextmenu={(e) => openDomainMenu(row.domain, e)}
				>
					<span
						class="domain-accent"
						style={`background-color: ${row.domain.color || "var(--text-faint)"};`}
					></span>

					<!-- Kind icon: this page's top-level rows are always domains. Same
					     icon the grid/timeline/backlog use for a domain association. -->
					<span class="kind-icon" title="Domain">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
					</span>

					{#if isEditing(row.domain)}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="name-input domain"
							value={row.domain.name}
							autofocus
							onclick={(e) => e.stopPropagation()}
							onblur={(e) => finishRename(row.domain, true, e.currentTarget.value)}
							onkeydown={(e) => {
								if (e.key === "Enter") e.currentTarget.blur();
								if (e.key === "Escape") { e.currentTarget.value = row.domain.name; e.currentTarget.blur(); }
							}}
						/>
					{:else}
						<button
							class="domain-name"
							title="Click to rename · Ctrl/Cmd-click to open file · Right-click for more"
							onclick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) openFile(row.domain, e); else startRename(row.domain); }}
						>{row.domain.name}</button>
					{/if}

					{#if row.domain.description}
						<span class="row-desc" title={row.domain.description}>{row.domain.description}</span>
					{/if}

					{#if statusOf(row.domain) !== "active"}
						<span class="status-tag">{STATUS_LABEL[statusOf(row.domain)]}</span>
					{/if}

					<span class="domain-count">{row.projects.length}</span>
					<span class="pv-spacer"></span>

					<!-- Color: a plain native color input. Clicking it opens the OS
					     picker; the swatch shows the current color. -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<label class="icon-btn color-btn" title="Set color" onclick={(e) => e.stopPropagation()}>
						<span class="swatch" style={`background:${row.domain.color || "var(--text-faint)"};`}></span>
						<input class="color-native" type="color" value={row.domain.color || "#888888"}
							oninput={(e) => pickColor(row.domain, e.currentTarget.value)} />
					</label>

					<!-- Backlog -->
					<button class="icon-btn" title="View this domain's backlog"
						onclick={(e) => { e.stopPropagation(); backlogForDomain(row); }} aria-label="View backlog">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
					</button>

					<!-- More actions (also available via right-click on the row) -->
					<button class="icon-btn" title="More actions"
						onclick={(e) => openDomainMenu(row.domain, e)} aria-label="More actions">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
					</button>
				</header>

				{#if row.projects.length === 0}
					<div class="group-empty">No projects here.</div>
				{:else}
					<ul class="project-list">
						{#each row.projects as project (project.source.path)}
							{@render projectRow(project)}
						{/each}
					</ul>
				{/if}
			</section>
		{/each}

		<!-- Orphan projects (no domain) -->
		{#if orphanRows.length > 0}
			<section class="domain-group">
				<header class="domain-header">
					<span class="domain-name unassigned">Unassigned</span>
					<span class="domain-count">{orphanRows.length}</span>
					<span class="pv-spacer"></span>
					<button class="icon-btn" title="New project"
						onclick={(e) => { e.stopPropagation(); createProject(undefined); }} aria-label="New project">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
					</button>
				</header>
				<ul class="project-list">
					{#each orphanRows as project (project.source.path)}
						{@render projectRow(project)}
					{/each}
				</ul>
			</section>
		{/if}

		{#if domainRows.length === 0 && orphanRows.length === 0}
			<div class="empty-state">
				Nothing to show. Create a domain or project, or adjust the filter above.
			</div>
		{/if}
	</div>
</div>

<!-- Status history overlay (portal) — read-only past records + add-at-date. -->
{#if historyRow}
	<Portal>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="history-scrim" onclick={closeHistory}>
			<div class="history-card" onclick={(e) => e.stopPropagation()}>
				<div class="history-head">
					<span class="history-title">{historyRow.name}</span>
					<span class="history-sub">Status history</span>
					<span class="pv-spacer"></span>
					<button class="history-x" title="Close" aria-label="Close" onclick={closeHistory}>
						<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>
				</div>

				{#if historyRow.history.length === 0}
					<div class="history-empty">No status changes recorded — defaults to Active.</div>
				{:else}
					{@const today = todayISO()}
					{@const effective = historyRow.history.filter((r) => r.date <= today).at(-1)}
					<ul class="history-list">
						{#each [...historyRow.history].reverse() as rec}
							{@const isCurrent = rec === effective}
							{@const isFuture = rec.date > today}
							<li class="history-item" class:current={isCurrent}>
								<span class="history-dot" class:active={rec.status === "active"}></span>
								<span class="history-status">{STATUS_LABEL[rec.status]}</span>
								<span class="pv-spacer"></span>
								<span class="history-date">{formatDate(rec.date)}</span>
								{#if isCurrent}<span class="history-badge">current</span>
								{:else if isFuture}<span class="history-badge">scheduled</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<!-- Add a new record. Past records are read-only (append-only history):
				     to correct one, edit the frontmatter JSON directly. -->
				<div class="history-add">
					<span class="history-add-label">Add change</span>
					<div class="history-add-row">
						<button class="history-date-btn" onclick={() => (historyPickDate = !historyPickDate)}>
							<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
							<span>{formatDate(isoFromDate(historyDate))}</span>
						</button>
						<span class="pv-spacer"></span>
						{#each historyStates as s}
							<button class="history-set" onclick={() => addStatusRecord(s)}>{STATUS_LABEL[s]}</button>
						{/each}
					</div>
					{#if historyPickDate}
						<div class="history-datepicker">
							<Datepicker inline bind:value={historyDate} onselect={() => (historyPickDate = false)} />
						</div>
					{/if}
				</div>
			</div>
		</div>
	</Portal>
{/if}

{#snippet projectRow(project: Project)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<li class="project-row" oncontextmenu={(e) => openProjectMenu(project, e)}>
		<span class="project-bullet"></span>

		{#if isEditing(project)}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="name-input"
				value={project.name}
				autofocus
				onclick={(e) => e.stopPropagation()}
				onblur={(e) => finishRename(project, false, e.currentTarget.value)}
				onkeydown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					if (e.key === "Escape") { e.currentTarget.value = project.name; e.currentTarget.blur(); }
				}}
			/>
		{:else}
			<button
				class="project-name"
				class:dim={statusOf(project) !== "active"}
				title="Click to rename · Ctrl/Cmd-click to open file · Right-click for more"
				onclick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) openFile(project, e); else startRename(project); }}
			>{project.name}</button>
		{/if}

		{#if project.description}
			<span class="row-desc" title={project.description}>{project.description}</span>
		{/if}

		{#if statusOf(project) !== "active"}
			<span class="status-tag">{STATUS_LABEL[statusOf(project)]}</span>
		{/if}

		<span class="pv-spacer"></span>

		<!-- The frequent action (open backlog) stays inline; the rest — change
		     domain, change status, delete — live in the context menu (right-click
		     the row, or the ⋯ button). -->
		<div class="row-actions">
			<!-- Backlog -->
			<button class="icon-btn" title="View this project's backlog"
				onclick={(e) => { e.stopPropagation(); backlogForProject(project); }} aria-label="View backlog">
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
			</button>

			<!-- More (context menu) -->
			<button class="icon-btn" title="More actions"
				onclick={(e) => openProjectMenu(project, e)} aria-label="More actions">
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
			</button>
		</div>
	</li>
{/snippet}

<style>
	.projects-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	/* ── Header ── */
	.pv-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px 8px;
		flex-shrink: 0;
	}
	.pv-title {
		font-size: 15px;
		font-weight: 700;
		color: var(--text-normal);
	}
	.pv-spacer {
		flex: 1;
	}
	.filter-group {
		display: flex;
		gap: 3px;
		background: var(--background-primary-alt);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		padding: 2px;
	}
	.filter-btn {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-faint);
		background: transparent;
		border: none;
		border-radius: 6px;
		padding: 3px 9px;
		cursor: pointer;
	}
	.filter-btn:hover {
		color: var(--text-muted);
	}
	.filter-btn.on {
		color: var(--text-on-accent);
		background: var(--interactive-accent);
	}
	.add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 26px;
		width: 26px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 7px;
		background: var(--background-primary-alt);
		color: var(--text-muted);
		cursor: pointer;
	}
	.add-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	/* Obsidian's base button styling can collapse an inline SVG to 0 width; pin
	   the icon so the reorder/add-domain glyphs actually render. */
	.add-btn svg {
		min-width: min-content;
		flex-shrink: 0;
	}

	/* ── Scroll body ── */
	.pv-scroll {
		flex: 1;
		overflow: auto;
		padding: 0 14px 18px;
	}
	.empty-state {
		color: var(--text-faint);
		font-size: 13px;
		font-style: italic;
		padding: 30px 8px;
		text-align: center;
		pointer-events: none;
	}

	/* ── Domain group ── */
	.domain-group {
		margin-bottom: 16px;
	}
	.domain-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 8px;
		border-radius: 7px;
		position: sticky;
		top: 0;
		background: var(--background-primary);
		z-index: 1;
	}
	/* The whole domain row is one hover object (spec §5). */
	.domain-header:hover {
		background: var(--background-modifier-hover);
	}
	.domain-header.dim {
		opacity: 0.55;
	}
	.domain-accent {
		width: 4px;
		height: 17px;
		border-radius: 2px;
		flex-shrink: 0;
	}
	.domain-name {
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--text-normal);
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	.domain-name:hover {
		color: var(--interactive-accent);
	}
	.domain-name.unassigned {
		color: var(--text-faint);
		font-style: italic;
		text-transform: none;
		letter-spacing: 0;
		cursor: default;
	}
	.project-name.dim {
		opacity: 0.55;
	}
	.domain-count {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	/* Inline description blurb (domains + projects), shown right after the name.
	   Truncates so a long blurb never pushes the action icons off the row. */
	.row-desc {
		font-size: 12px;
		font-weight: 400;
		color: var(--text-muted);
		text-transform: none;
		letter-spacing: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 0 1 auto;
	}
	.status-tag {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-faint);
		border: 1px solid var(--background-modifier-border);
		border-radius: 5px;
		padding: 1px 5px;
	}
	.group-empty {
		font-size: 12px;
		color: var(--text-faint);
		padding: 3px 14px 6px;
		font-style: italic;
	}

	/* ── Project list ── */
	.project-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.project-row {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 10px 5px 8px;
		border-radius: 7px;
		position: relative;
	}
	.project-row:hover {
		background: var(--background-modifier-hover);
	}
	.project-bullet {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--text-faint);
		flex-shrink: 0;
		margin: 0 3px 0 6px;
	}
	.project-name {
		font-size: 13px;
		color: var(--text-normal);
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
	}
	.project-name:hover {
		color: var(--interactive-accent);
	}
	/* Rename inputs (project + domain) are styled to be indistinguishable from the
	   static name — no box, no border, no box-shadow — so renaming feels like
	   putting the cursor on the name, matching the backlog/task rows. The domain
	   variant keeps the heading's uppercase weight so it doesn't jump on edit. */
	.name-input {
		font-size: 13px;
		font-family: inherit;
		color: var(--text-normal);
		background: transparent;
		border: none;
		border-radius: 0;
		box-shadow: none;
		outline: none;
		padding: 0;
		margin: 0;
		min-width: 0;
		flex: 1;
	}
	.name-input:focus,
	.name-input:focus-visible {
		border: none;
		box-shadow: none;
		outline: none;
	}
	.name-input.domain {
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	/* ── Kind icon (domain marker in the header) ── */
	.kind-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		flex-shrink: 0;
		/* Obsidian's base styling can collapse an inline SVG to 0 width; pin it. */
		min-width: min-content;
	}

	/* ── Row action bar (always visible on this page) ── */
	.row-actions {
		display: flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
	}

	/* ── Icon buttons ── */
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 24px;
		width: 24px;
		/* Pin the intrinsic size so Obsidian's button styling can't collapse the
		   icon (the SVG otherwise vanishes without a min-width). */
		min-width: min-content;
		border: 1px solid transparent;
		border-radius: 6px;
		box-shadow: none;
		background: transparent;
		color: var(--text-faint);
		cursor: pointer;
		flex-shrink: 0;
	}
	.project-row:hover .icon-btn,
	.domain-header .icon-btn {
		color: var(--text-muted);
	}
	.icon-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border);
		box-shadow: none;
	}
	.icon-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	/* Color control: the swatch sits in an icon-btn; the native <input type=color>
	   is stretched invisibly over it so a click opens the OS picker directly. */
	.color-btn {
		position: relative;
		overflow: hidden;
	}
	.color-btn .swatch {
		width: 14px;
		height: 14px;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
	}
	.color-native {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
	}

	/* ── Status history overlay ── */
	.history-scrim {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.35);
	}
	.history-card {
		width: 340px;
		max-width: calc(100vw - 32px);
		max-height: 70vh;
		overflow: auto;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 10px;
		box-shadow: var(--shadow-l, 0 8px 30px rgba(0, 0, 0, 0.3));
		padding: 14px 14px 12px;
	}
	.history-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 10px;
	}
	.history-title {
		font-size: 14px;
		font-weight: 700;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.history-sub {
		font-size: 11px;
		color: var(--text-faint);
	}
	.history-x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		min-width: min-content;
		border: none;
		box-shadow: none;
		border-radius: 5px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		align-self: center;
	}
	.history-x:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		box-shadow: none;
	}
	.history-empty {
		font-size: 12px;
		color: var(--text-faint);
		font-style: italic;
		padding: 4px 0 10px;
	}
	.history-list {
		list-style: none;
		margin: 0 0 10px;
		padding: 0;
	}
	.history-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px;
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.history-item.current {
		font-weight: 600;
	}
	.history-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-faint);
		flex-shrink: 0;
	}
	.history-dot.active {
		background: var(--interactive-accent);
	}
	.history-status {
		font-size: 12px;
		color: var(--text-normal);
	}
	.history-date {
		font-size: 11px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.history-badge {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-on-accent);
		background: var(--interactive-accent);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.history-add {
		border-top: 1px solid var(--background-modifier-border);
		padding-top: 10px;
	}
	.history-add-label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-faint);
	}
	.history-add-row {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-top: 6px;
	}
	.history-date-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 26px;
		padding: 0 8px;
		font-size: 11px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary-alt);
		color: var(--text-normal);
		cursor: pointer;
	}
	.history-date-btn:hover {
		background: var(--background-modifier-hover);
	}
	.history-set {
		height: 26px;
		padding: 0 10px;
		font-size: 11px;
		font-weight: 600;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary-alt);
		color: var(--text-normal);
		cursor: pointer;
	}
	.history-set:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		border-color: var(--interactive-accent);
	}
	.history-datepicker {
		margin-top: 8px;
	}
</style>
