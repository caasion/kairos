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
	import { todayISO } from "../../dayNote";
	import { effectiveStatus } from "../../projectFile";
	import { DomainReorderModal } from "./DomainReorderModal";
	import { StatusHistoryModal } from "./StatusHistoryModal";
	import { ConfirmModal, PromptModal } from "./modals";

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

	// Active entities always sort above non-active ones (inactive/archived sink to
	// the bottom), preserving the source order within each band. A stable partition
	// keeps domain order (the global reorder) and file order (projects) intact
	// among peers of the same activity.
	function activeFirst<T extends Project | Domain>(items: T[]): T[] {
		const active: T[] = [];
		const rest: T[] = [];
		for (const e of items) (statusOf(e) === "active" ? active : rest).push(e);
		return [...active, ...rest];
	}

	// ── Rows: domains (filtered, keeping any that still have visible children) ──
	interface DomainRow {
		domain: Domain;
		projects: Project[];
	}

	const domainRows = $derived.by<DomainRow[]>(() => {
		const rows: DomainRow[] = [];
		for (const domain of feed.domains) {
			const projects = activeFirst(
				(feed.projectsByDomain.get(domain.id) ?? []).filter(passesFilter),
			);
			// Show a domain if it itself passes, or it still has visible children.
			if (passesFilter(domain) || projects.length > 0) {
				rows.push({ domain, projects });
			}
		}
		// Active domains first; inactive domains sink to the bottom of the list.
		return activeFirst(rows.map((r) => r.domain)).map(
			(domain) => rows.find((r) => r.domain === domain)!,
		);
	});

	const orphanRows = $derived(activeFirst(feed.orphans.filter(passesFilter)));

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

	// Archive (projects only — domains are durable and can't archive). A one-click
	// path to the archived state, stamped today; if already archived it swings
	// back to active, mirroring toggleStatus's shape.
	function archiveProject(project: Project) {
		const next: LifecycleState =
			statusOf(project) === "archived" ? "active" : "archived";
		setProjectStatus(index, project, todayISO(), next);
	}

	// ── Status history (native modal) ──
	// The history is an editable log; adding/editing/deleting a record routes
	// through the pure edit functions (they own the invariants). The modal owns
	// the chrome and mounts the editable log as a Svelte component that re-resolves
	// the row from the live feed, so edits refresh in place.
	function openHistory(e: Project | Domain) {
		const isDomain = feed.domains.some((d) => d.source.path === e.source.path);
		new StatusHistoryModal(app, index, {
			name: e.name,
			path: e.source.path,
			isDomain,
		}).open();
	}

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
		// Archive is a one-click shortcut to the archived state (spec §4.4:
		// archiving is the preferred alternative to deletion). Toggles back to
		// active when the project is already archived.
		menu.addItem((item) =>
			item
				.setTitle(
					statusOf(project) === "archived" ? "Unarchive" : "Archive",
				)
				.setIcon("archive")
				.onClick(() => archiveProject(project)),
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
			{@const domainInactive = statusOf(row.domain) !== "active"}
			<section
				class="domain-group"
				style={`--domain-accent: ${row.domain.color || "var(--text-faint)"};`}
			>
				<!-- The whole header is one interactive object: hovering highlights the
				     full line, right-click opens the context menu (change status, add
				     project, delete, …). Only color and backlog stay as inline icons.
				     The group's accent is the domain color: it tints the kind icon here
				     and runs as a continuous left line down the project list below (like
				     the grid/week views), so a domain and its projects read as one block. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<header
					class="domain-header"
					class:dim={domainInactive}
					oncontextmenu={(e) => openDomainMenu(row.domain, e)}
				>
					<!-- Kind icon: this page's top-level rows are always domains. Same
					     icon the grid/timeline/backlog use for a domain association,
					     tinted the domain's color to accent it (in place of a stripe). -->
					<span class="kind-icon" title="Domain">
						<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
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
					<!-- The continuous accent line lives on the list, so it spans every
					     child project and stops at the last one — extending the domain's
					     accent down through its projects. -->
					<ul class="project-list accented" class:dim={domainInactive}>
						{#each row.projects as project (project.source.path)}
							{@render projectRow(project, domainInactive)}
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
						{@render projectRow(project, false)}
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

{#snippet projectRow(project: Project, disabled: boolean)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- When the parent domain is inactive its projects are read-only history:
	     the row dims and its rename / context-menu / action buttons go inert. -->
	<li
		class="project-row"
		class:disabled
		oncontextmenu={(e) => { if (!disabled) openProjectMenu(project, e); }}
	>
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
				{disabled}
				title={disabled
					? "Its domain is inactive"
					: "Click to rename · Ctrl/Cmd-click to open file · Right-click for more"}
				onclick={(e) => { e.stopPropagation(); if (disabled) return; if (e.ctrlKey || e.metaKey) openFile(project, e); else startRename(project); }}
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
		     the row, or the ⋯ button). All inert while the domain is inactive. -->
		<div class="row-actions">
			<!-- Backlog -->
			<button class="icon-btn" title="View this project's backlog" {disabled}
				onclick={(e) => { e.stopPropagation(); backlogForProject(project); }} aria-label="View backlog">
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
			</button>

			<!-- More (context menu) -->
			<button class="icon-btn" title="More actions" {disabled}
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
	/* The domain's accent continues as a left line down its project list (mirrors
	   the grid/week views), so a domain and its projects read as one block. The
	   line descends from under the domain's tinted kind icon (~15px in); rows are
	   indented to clear it. It fades with the group when the domain is inactive. */
	.project-list.accented {
		margin-left: 15px;
		border-left: 2px solid var(--domain-accent, var(--text-faint));
	}
	.project-list.accented.dim {
		opacity: 0.55;
	}
	.project-row {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 10px 5px 8px;
		border-radius: 7px;
		position: relative;
	}
	.project-list.accented .project-row {
		padding-left: 10px;
	}
	.project-row:hover {
		background: var(--background-modifier-hover);
	}
	/* A project whose domain is inactive is read-only history: dim it and let the
	   inert buttons/name (disabled) show the not-allowed affordance. */
	.project-row.disabled {
		opacity: 0.55;
	}
	.project-row.disabled:hover {
		background: transparent;
	}
	.project-name:disabled {
		cursor: default;
		color: var(--text-muted);
	}
	.project-name:disabled:hover {
		color: var(--text-muted);
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
	/* The domain kind icon carries the domain's accent color (its stripe used to);
	   falls back to faint when no color is set. */
	.kind-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--domain-accent, var(--text-faint));
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
</style>
