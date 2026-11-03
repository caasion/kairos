<script lang="ts">
	// The Projects & Domains page (spec §5). Two panes: on the left one list,
	// durable domains as top-level rows, their projects nested beneath, plus an
	// "Unassigned" group for projects with no domain; on the right the selected
	// one's details and status history (ProjectDetail). When the view is too
	// narrow for both, it shows the list, then the details in its place. A status
	// filter (Active / Inactive / Archived) sits in the header; archived is
	// hidden by default.
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
		editDomainStatusRecord,
		editProjectStatusRecord,
		renameDomain,
		renameProject,
		setDomainDescription,
		setDomainOrder,
		setDomainStatus,
		setProjectDescription,
		setProjectStatus,
	} from "../../projectActions";
	import { todayISO } from "../../dayNote";
	import { effectiveStatus } from "../../projectFile";
	import { DomainReorderModal } from "./DomainReorderModal";
	import { addChangeDomainItem, addRollupItem } from "./projectMenu";
	import ProjectDetail from "./ProjectDetail.svelte";
	import SegmentedControl from "../components/SegmentedControl.svelte";
	import { ConfirmModal, PromptModal, WhyModal } from "./modals";
	import Tag from "../components/Tag.svelte";
	import AssocGroup from "../components/AssocGroup.svelte";
	import IconButton from "../components/IconButton.svelte";
	import { intoViewHeader } from "../actions/viewHeader";

	interface Props {
		app: App;
		index: KairosIndex;
		openBacklogFiltered: (names: string[], label: string) => void;
		/** The tab's header, which the filters and buttons move into. */
		viewHeader?: HTMLElement;
	}

	let { app, index, openBacklogFiltered, viewHeader }: Props = $props();

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
		changeStatus(e, isDomain, next);
	}
	// `ask` false: the caller asks for the reason itself (the detail pane
	// starts typing it in the history instead of opening a dialog).
	function changeStatus(
		e: Project | Domain,
		isDomain: boolean,
		next: LifecycleState,
		ask = true,
	): boolean {
		if (next === statusOf(e)) return false;
		if (isDomain) setDomainStatus(index, e as Domain, todayISO(), next);
		else setProjectStatus(index, e as Project, todayISO(), next);
		if (ask) askWhy(e, isDomain, next);
		return true;
	}

	// Archive (projects only — domains are durable and can't archive). A one-click
	// path to the archived state, stamped today; if already archived it swings
	// back to active, mirroring toggleStatus's shape.
	function archiveProject(project: Project) {
		const next: LifecycleState =
			statusOf(project) === "archived" ? "active" : "archived";
		changeStatus(project, false, next);
	}

	// ── "Why did this change?" (#26) ──
	// A transition into inactive or archived is applied first and the reason is
	// asked for afterwards in a modal, so the change never waits on the answer
	// and skipping it is free. Going active doesn't ask: it is usually
	// self-evident, and asking on every change trains dismissal. A typed reason is
	// attached with a second edit against the *re-read* entity — the one this row
	// rendered went stale the moment the status write landed.
	function askWhy(e: Project | Domain, isDomain: boolean, status: LifecycleState) {
		if (status === "active") return;
		const path = e.source.path;
		const date: ISODate = todayISO();
		new WhyModal(app, {
			title: `${e.name} is now ${STATUS_LABEL[status].toLowerCase()}`,
			onSave: (why) => attachWhy(path, isDomain, date, why),
		}).open();
	}

	function attachWhy(path: string, isDomain: boolean, date: ISODate, why: string) {
		const { projects, domains } = index.snapshot();
		const pool: (Project | Domain)[] = isDomain
			? [...domains.values()]
			: [...projects.values()];
		const live = pool.find((x) => x.source.path === path);
		// The record the transition wrote. Absent if it collapsed as a no-op or was
		// undone in the meantime — then there is nothing to attach a reason to.
		const rec = live?.history.find((r) => r.date === date);
		if (!live || !rec) return;
		const next = { date, status: rec.status, note: rec.note ?? "", why };
		if (isDomain) editDomainStatusRecord(index, live as Domain, date, next);
		else editProjectStatusRecord(index, live as Project, date, next);
	}

	// ── Selection: the one shown in the detail pane ──
	// Held by its stable source path and re-resolved from the live feed, so the
	// pane follows every edit (and empties if the file goes away).
	let selected = $state<{ path: string; isDomain: boolean } | null>(null);

	function select(e: Project | Domain, isDomain: boolean) {
		selected = { path: e.source.path, isDomain };
	}
	function isSelected(e: Project | Domain): boolean {
		return selected?.path === e.source.path;
	}

	const selectedEntity = $derived.by<Project | Domain | null>(() => {
		const sel = selected;
		if (!sel) return null;
		if (sel.isDomain) return feed.domains.find((d) => d.source.path === sel.path) ?? null;
		for (const list of feed.projectsByDomain.values()) {
			const hit = list.find((p) => p.source.path === sel.path);
			if (hit) return hit;
		}
		return feed.orphans.find((p) => p.source.path === sel.path) ?? null;
	});

	// A project under an inactive domain is read-only history, here as in the list.
	const selectedReadonly = $derived.by(() => {
		const e = selectedEntity;
		if (!e || selected?.isDomain) return false;
		const parent = feed.domains.find((d) => d.id === (e as Project).domain);
		return !!parent && statusOf(parent) !== "active";
	});

	// ── Domain reorder (global, via a modal) ──
	function openReorder() {
		new DomainReorderModal(app, feed.domains, (ordered) => {
			// Persist the new global order: renumber sequentially so gaps/dupes clear.
			ordered.forEach((d, i) => {
				if (d.order !== i) setDomainOrder(index, d, i);
			});
		}).open();
	}

	// The domain a project is rolled up onto in the Grid (#11), by name — or
	// undefined when it keeps its own row (flag off, or no domain to roll into).
	function rollupDomainName(project: Project): string | undefined {
		if (!project.rollup || !project.domain) return undefined;
		return feed.domains.find((d) => d.id === project.domain)?.name;
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
		// Change domain (a submenu of every domain + None) and the Grid rollup
		// toggle (#11) — shared with the Grid's row-label menu so both match.
		addChangeDomainItem(menu, index, project, feed.domains);
		addRollupItem(menu, index, project);
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

	// ── Open the markdown file (ctrl/⌘-click, or the detail pane's button) ──
	function openFile(e: Project | Domain, ev: MouseEvent) {
		if (!(ev.ctrlKey || ev.metaKey)) return;
		ev.preventDefault();
		ev.stopPropagation();
		openNote(e);
	}
	function openNote(e: Project | Domain) {
		const file = app.vault.getAbstractFileByPath(e.source.path);
		if (file instanceof TFile) void app.workspace.getLeaf("tab").openFile(file);
	}

	// ── Backlog navigation (spec §5, settled rule) ──
	function backlogForDomain(row: DomainRow) {
		// Domain button → the domain + all its (visible) child projects.
		const names = [row.domain.name, ...row.projects.map((p) => p.name)];
		openBacklogFiltered(names, row.domain.name);
	}
	function backlogForSelected(e: Project | Domain, isDomain: boolean) {
		if (!isDomain) return backlogForProject(e as Project);
		const row = domainRows.find((r) => r.domain === e);
		if (row) backlogForDomain(row);
		else openBacklogFiltered([e.name], e.name);
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
			title: `Delete "${project.name}"?`,
			message:
				`This deletes the project's note. Daily notes that tag it keep the ` +
				`tag, but it loses its color and no longer opens the project.\n\n` +
				`To put it away and keep its history, archive it instead.`,
			cta: "Delete",
			danger: true,
			onConfirm: () => void index.deleteProject(project.name),
			alt:
				statusOf(project) === "archived"
					? undefined
					: { text: "Archive instead", onClick: () => archiveProject(project) },
		}).open();
	}
	function deleteDomain(domain: Domain) {
		new ConfirmModal(app, {
			title: `Delete "${domain.name}"?`,
			message:
				`This deletes the domain's note. Daily notes that tag it keep the ` +
				`tag but lose its color, and its projects no longer have a domain.\n\n` +
				`To set it aside for now, make it inactive instead.`,
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
	<!-- In the tab's header, like the other views' bars: the tab already names
	     the page, so there's no title of its own. -->
	<div class="pv-header" use:intoViewHeader={viewHeader}>
		<span class="pv-spacer"></span>

		<SegmentedControl
			label="Show"
			options={(["active", "inactive", "archived"] as const).map((f) => ({ value: f, label: STATUS_LABEL[f] }))}
			isOn={(f) => filter.has(f as Filter)}
			onSelect={(f) => toggleFilter(f as Filter)}
		/>

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

		<!-- Always here, so a first project needs no domain (the Unassigned group's
		     own + only shows once a domain-less project exists). -->
		<button
			class="add-btn"
			title="New project"
			onclick={(e) => {
				e.stopPropagation();
				createProject(undefined);
			}}
			aria-label="New project"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
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

	<div class="pv-panes" class:has-selection={selectedEntity !== null}>
	<div class="pv-scroll pv-list">
		{#each domainRows as row (row.domain.id)}
			{@const domainInactive = statusOf(row.domain) !== "active"}
			<!-- The group heading every list uses (AssocGroup): the domain icon, the
			     name in serif and its count, and a bar in the domain color down its
			     projects. Select it to show its details, Ctrl/Cmd+click to open the
			     file, right-click (or ⋯) for the rest. -->
			<AssocGroup
				assoc={{ kind: "domain", id: row.domain.id }}
				label={row.domain.name}
				color={row.domain.color || undefined}
				count={row.projects.length}
				sticky
				dim={domainInactive}
				editing={isEditing(row.domain)}
				selected={isSelected(row.domain)}
				onSelect={() => select(row.domain, true)}
				onRename={(name: string) => finishRename(row.domain, true, name)}
				onOpen={(e: MouseEvent) => openFile(row.domain, e)}
				oncontextmenu={(e: MouseEvent) => openDomainMenu(row.domain, e)}
			>
				{#snippet meta()}
					{#if row.domain.description}
						<span class="row-desc" title={row.domain.description}>{row.domain.description}</span>
					{/if}
					{#if domainInactive}
						<Tag>{STATUS_LABEL[statusOf(row.domain)]}</Tag>
					{/if}
				{/snippet}
				{#snippet actions()}
					<IconButton label="View this domain's backlog" icon="inbox" onclick={() => backlogForDomain(row)} />
					<IconButton label="More actions" icon="more-horizontal" onclick={(e: MouseEvent) => openDomainMenu(row.domain, e)} />
				{/snippet}

				{#if row.projects.length === 0}
					<div class="group-empty">No projects here.</div>
				{:else}
					<ul class="project-list">
						{#each row.projects as project (project.source.path)}
							{@render projectRow(project, domainInactive)}
						{/each}
					</ul>
				{/if}
			</AssocGroup>
		{/each}

		<!-- Orphan projects (no domain) -->
		{#if orphanRows.length > 0}
			<AssocGroup
				noneLabel="Unassigned"
				count={orphanRows.length}
				sticky
				addLabel="New project"
				onAdd={() => createProject(undefined)}
			>
				<ul class="project-list">
					{#each orphanRows as project (project.source.path)}
						{@render projectRow(project, false)}
					{/each}
				</ul>
			</AssocGroup>
		{/if}

		{#if domainRows.length === 0 && orphanRows.length === 0}
			<div class="empty-state">
				Nothing to show. Create a domain or project, or adjust the filter above.
			</div>
		{/if}
	</div>

	<div class="pv-scroll pv-detail">
		{#if selectedEntity && selected}
			{@const e = selectedEntity}
			{@const isDomain = selected.isDomain}
			<!-- Keyed by the selection, so switching rows drops a half-edited change. -->
			{#key selected.path}
			<ProjectDetail
				{index}
				entity={e}
				{isDomain}
				domains={feed.domains}
				readonly={selectedReadonly}
				onRename={(name: string) => finishRename(e, isDomain, name)}
				onSetStatus={(next: LifecycleState) => changeStatus(e, isDomain, next, false)}
				onOpenFile={() => openNote(e)}
				onBacklog={() => backlogForSelected(e, isDomain)}
				onMenu={(ev: MouseEvent) =>
					isDomain ? openDomainMenu(e as Domain, ev) : openProjectMenu(e as Project, ev)}
				onBack={() => (selected = null)}
			/>
			{/key}
		{:else}
			<div class="empty-state">Select a project or domain to see its details.</div>
		{/if}
	</div>
	</div>
</div>

{#snippet projectRow(project: Project, disabled: boolean)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- When the parent domain is inactive its projects are read-only history:
	     the row dims and its rename / context-menu / action buttons go inert. -->
	<!-- The name button is the keyboard way in; the row is the bigger target. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<li
		class="project-row"
		class:disabled
		class:is-selected={isSelected(project)}
		onclick={(e) => { e.stopPropagation(); if (!isEditing(project)) select(project, false); }}
		oncontextmenu={(e) => { if (!disabled) openProjectMenu(project, e); }}
	>
		<span class="project-bullet"></span>

		{#if isEditing(project)}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="name-input kairos-inline-input"
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
				title={disabled
					? "Its domain is inactive"
					: "Click for details · Ctrl/Cmd+click to open file · Right-click for more"}
				onclick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) openFile(project, e); else select(project, false); }}
			>{project.name}</button>
		{/if}

		{#if rollupDomainName(project)}
			<!-- Shown on its domain's Grid row instead of its own (#11). -->
			<span
				class="kairos-meta rollup-marker"
				title="Shown on {rollupDomainName(project)}'s row in the Grid"
				aria-label="Shown on {rollupDomainName(project)}'s row in the Grid"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3-3-3 3"/><path d="m15 5-3 3-3-3"/></svg>
			</span>
		{/if}

		{#if project.description}
			<span class="row-desc" title={project.description}>{project.description}</span>
		{/if}

		{#if statusOf(project) !== "active"}
			<Tag>{STATUS_LABEL[statusOf(project)]}</Tag>
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
	.pv-spacer {
		flex: 1;
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

	/* ── Two panes: the list, and the selected one's details ── */
	.projects-view {
		container: kairos-projects / inline-size;
	}
	.pv-panes {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.pv-scroll {
		overflow: auto;
		padding: 0 14px 18px;
	}
	.pv-list {
		flex: 0 0 clamp(260px, 38%, 420px);
		border-right: var(--border-width) solid var(--background-modifier-border);
	}
	.pv-detail {
		flex: 1;
		min-width: 0;
		padding: var(--size-4-2) var(--size-4-6) var(--size-4-8);
	}
	/* Too narrow for both: the list, then the details in its place. */
	@container kairos-projects (max-width: 640px) {
		.pv-list {
			flex: 1;
			border-right: none;
		}
		.pv-detail,
		.pv-panes.has-selection .pv-list {
			display: none;
		}
		.pv-panes.has-selection .pv-detail {
			display: block;
		}
	}
	.empty-state {
		color: var(--text-faint);
		font-size: 13px;
		font-style: italic;
		padding: 30px 8px;
		text-align: center;
		pointer-events: none;
	}

	.project-name.dim {
		opacity: 0.55;
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
	.rollup-marker {
		flex-shrink: 0;
		color: var(--text-faint);
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
	.project-row {
		cursor: pointer;
	}
	.project-row:hover {
		background: var(--background-modifier-hover);
	}
	.project-row.is-selected {
		background: var(--background-modifier-active-hover);
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
	/* A project's rename input is styled to be indistinguishable from the
	   static name — no box, no border, no box-shadow — so renaming feels like
	   putting the cursor on the name, matching the backlog/task rows. A domain's
	   is AssocGroup's. */
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
	.project-row:hover .icon-btn {
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

</style>
