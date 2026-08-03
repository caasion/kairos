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
	import { TFile } from "obsidian";
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
		setDomainOrder,
		setDomainStatus,
		setProjectDomain,
		setProjectStatus,
	} from "../../projectActions";
	import { todayISO } from "../../dayNote";

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

	/** An entity's current lifecycle state: the latest status record, or active. */
	function statusOf(e: Project | Domain): LifecycleState {
		return e.history.at(-1)?.status ?? "active";
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
	let colorDomain = $state<Domain | null>(null); // domain whose color popup is open
	let statusRow = $state<Project | Domain | null>(null); // status popup target
	let statusRowPath = $state<string | null>(null);
	let domainPickerPath = $state<string | null>(null); // project row whose domain popup is open

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
	function openStatus(e: Project | Domain) {
		statusRow = e;
		statusRowPath = e.source.path;
	}
	function closeStatus() {
		statusRow = null;
		statusRowPath = null;
	}
	function pickStatus(e: Project | Domain, isDomain: boolean, status: LifecycleState) {
		closeStatus();
		if (statusOf(e) === status) return;
		if (isDomain) setDomainStatus(index, e as Domain, todayISO(), status);
		else setProjectStatus(index, e as Project, todayISO(), status);
	}

	// ── Domain color ──
	function pickColor(domain: Domain, color: string) {
		setDomainColor(index, domain, color);
	}

	// A small preset palette; the native color input covers everything else.
	const PALETTE = [
		"#e05555", "#e0a355", "#e0d355", "#8ac555",
		"#55c5a3", "#55a3e0", "#8a55e0", "#c555b0",
	];

	// ── Domain reorder ──
	function moveDomain(row: DomainRow, delta: number) {
		const idx = feed.domains.findIndex((d) => d.id === row.domain.id);
		const swapWith = feed.domains[idx + delta];
		if (!swapWith) return;
		// Swap orders so the two adjacent rows trade places.
		setDomainOrder(index, row.domain, swapWith.order);
		setDomainOrder(index, swapWith, row.domain.order);
	}

	// ── Domain link (project → domain) ──
	// A small inline popup listing every domain (durable, so none are archived)
	// plus "None" to clear. The project stores the domain's stable id.
	function openDomainPicker(project: Project, e: MouseEvent) {
		e.stopPropagation();
		domainPickerPath = project.source.path;
	}
	function closeDomainPicker() {
		domainPickerPath = null;
	}
	function pickDomain(project: Project, domainId: string | undefined) {
		closeDomainPicker();
		if (project.domain === domainId) return;
		setProjectDomain(index, project, domainId);
	}

	function currentDomainName(project: Project): string | undefined {
		if (!project.domain) return undefined;
		return feed.domains.find((d) => d.id === project.domain)?.name;
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

	// ── Create ──
	async function createDomain() {
		const name = window.prompt("New domain name")?.trim();
		if (!name) return;
		const clash = index.nameCollision(name);
		if (clash) {
			window.alert(`"${name}" collides with "${clash}".`);
			return;
		}
		await index.createDomain(name);
	}
	async function createProject(domainId?: string) {
		const name = window.prompt("New project name")?.trim();
		if (!name) return;
		const clash = index.nameCollision(name);
		if (clash) {
			window.alert(`"${name}" collides with "${clash}".`);
			return;
		}
		await index.createProject(name, domainId);
	}

	// ── Delete (spec §4.4 — allowed, with a dangling-reference warning) ──
	function deleteProject(project: Project) {
		const ok = window.confirm(
			`Delete project "${project.name}"?\n\n` +
				`Archiving is usually better. Any daily-note tags naming this ` +
				`project (including its aliases) will become dangling references — ` +
				`they'll still show by name but lose their color.`,
		);
		if (ok) void index.deleteProject(project.name);
	}
	function deleteDomain(domain: Domain) {
		const ok = window.confirm(
			`Delete domain "${domain.name}"?\n\n` +
				`Archiving is usually better. Any daily-note tags naming this ` +
				`domain (including its aliases), and projects linked to it, will ` +
				`become dangling references.`,
		);
		if (ok) void index.deleteDomain(domain.name);
	}

	function isEditing(e: Project | Domain): boolean {
		return editingName === e.source.path;
	}

	function handleClickOutside() {
		editingName = null;
		colorDomain = null;
		closeStatus();
		closeDomainPicker();
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

		<button
			class="add-btn"
			title="New domain"
			onclick={(e) => {
				e.stopPropagation();
				void createDomain();
			}}
			aria-label="New domain"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
		</button>
	</div>

	<div class="pv-scroll">
		{#each domainRows as row, i (row.domain.id)}
			<section class="domain-group">
				<header class="domain-header">
					<span
						class="domain-accent"
						style={`background-color: ${row.domain.color || "var(--text-faint)"};`}
					></span>

					{#if isEditing(row.domain)}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="name-input"
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
							class:dim={statusOf(row.domain) !== "active"}
							title="Click to rename · Ctrl/⌘-click to open file"
							onclick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) openFile(row.domain, e); else startRename(row.domain); }}
						>{row.domain.name}</button>
					{/if}

					{#if statusOf(row.domain) !== "active"}
						<span class="status-tag">{STATUS_LABEL[statusOf(row.domain)]}</span>
					{/if}

					<span class="domain-count">{row.projects.length}</span>
					<span class="pv-spacer"></span>

					<!-- Reorder -->
					<button class="icon-btn" title="Move up" disabled={i === 0}
						onclick={(e) => { e.stopPropagation(); moveDomain(row, -1); }} aria-label="Move up">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
					</button>
					<button class="icon-btn" title="Move down" disabled={i === domainRows.length - 1}
						onclick={(e) => { e.stopPropagation(); moveDomain(row, 1); }} aria-label="Move down">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
					</button>

					<!-- Color -->
					<button class="icon-btn color-btn" title="Set color"
						onclick={(e) => { e.stopPropagation(); colorDomain = colorDomain?.id === row.domain.id ? null : row.domain; }}
						aria-label="Set color">
						<span class="swatch" style={`background:${row.domain.color || "var(--text-faint)"};`}></span>
					</button>

					<!-- Status -->
					<button class="icon-btn" title="Change status"
						onclick={(e) => { e.stopPropagation(); openStatus(row.domain); }} aria-label="Change status">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
					</button>

					<!-- Backlog -->
					<button class="icon-btn" title="View this domain's backlog"
						onclick={(e) => { e.stopPropagation(); backlogForDomain(row); }} aria-label="View backlog">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
					</button>

					<!-- Add project to this domain -->
					<button class="icon-btn" title="New project in this domain"
						onclick={(e) => { e.stopPropagation(); void createProject(row.domain.id); }} aria-label="New project">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
					</button>

					<!-- Delete -->
					<button class="icon-btn danger" title="Delete domain"
						onclick={(e) => { e.stopPropagation(); deleteDomain(row.domain); }} aria-label="Delete domain">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>

					<!-- Color popup -->
					{#if colorDomain?.id === row.domain.id}
						<div class="popup color-popup" onclick={(e) => e.stopPropagation()}>
							<div class="palette">
								{#each PALETTE as c}
									<button class="palette-swatch" style={`background:${c};`}
										onclick={() => { pickColor(row.domain, c); colorDomain = null; }} aria-label={c}></button>
								{/each}
							</div>
							<input class="color-input" type="color" value={row.domain.color || "#888888"}
								oninput={(e) => pickColor(row.domain, e.currentTarget.value)} />
							<button class="clear-link" onclick={() => { pickColor(row.domain, ""); colorDomain = null; }}>Clear</button>
						</div>
					{/if}

					<!-- Status popup -->
					{#if statusRowPath === row.domain.source.path}
						<div class="popup status-popup" onclick={(e) => e.stopPropagation()}>
							{#each ["active", "inactive"] as const as s}
								<button class="status-opt" class:sel={statusOf(row.domain) === s}
									onclick={() => pickStatus(row.domain, true, s)}>{STATUS_LABEL[s]}</button>
							{/each}
							<span class="status-note">Domains don't archive</span>
						</div>
					{/if}
				</header>

				{#if row.projects.length === 0}
					<div class="group-empty">No projects here.</div>
				{:else}
					<ul class="project-list">
						{#each row.projects as project (project.source.path)}
							{@render projectRow(project, true)}
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
						onclick={(e) => { e.stopPropagation(); void createProject(undefined); }} aria-label="New project">
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

{#snippet projectRow(project: Project, inDomain: boolean)}
	<li class="project-row">
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
				title="Click to rename · Ctrl/⌘-click to open file"
				onclick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) openFile(project, e); else startRename(project); }}
			>{project.name}</button>
		{/if}

		{#if statusOf(project) !== "active"}
			<span class="status-tag">{STATUS_LABEL[statusOf(project)]}</span>
		{/if}

		<span class="pv-spacer"></span>

		<!-- Domain link chip -->
		<button class="chip domain-chip" class:ghost={!currentDomainName(project)}
			title="Change domain"
			onclick={(e) => openDomainPicker(project, e)}>
			{#if currentDomainName(project)}
				{currentDomainName(project)}
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
			{/if}
		</button>

		<!-- Status -->
		<button class="icon-btn" title="Change status"
			onclick={(e) => { e.stopPropagation(); openStatus(project); }} aria-label="Change status">
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
		</button>

		<!-- Backlog -->
		<button class="icon-btn" title="View this project's backlog"
			onclick={(e) => { e.stopPropagation(); backlogForProject(project); }} aria-label="View backlog">
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
		</button>

		<!-- Delete -->
		<button class="icon-btn danger" title="Delete project"
			onclick={(e) => { e.stopPropagation(); deleteProject(project); }} aria-label="Delete project">
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
		</button>

		<!-- Status popup -->
		{#if statusRowPath === project.source.path}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="popup status-popup" onclick={(e) => e.stopPropagation()}>
				{#each ["active", "inactive", "archived"] as const as s}
					<button class="status-opt" class:sel={statusOf(project) === s}
						onclick={() => pickStatus(project, false, s)}>{STATUS_LABEL[s]}</button>
				{/each}
			</div>
		{/if}

		<!-- Domain-link popup -->
		{#if domainPickerPath === project.source.path}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="popup domain-popup" onclick={(e) => e.stopPropagation()}>
				<button class="status-opt" class:sel={!project.domain}
					onclick={() => pickDomain(project, undefined)}>None</button>
				{#each feed.domains as d (d.id)}
					<button class="status-opt" class:sel={project.domain === d.id}
						onclick={() => pickDomain(project, d.id)}>
						<span class="opt-swatch" style={`background:${d.color || "var(--text-faint)"};`}></span>
						{d.name}
					</button>
				{/each}
			</div>
		{/if}
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
	}

	/* ── Domain group ── */
	.domain-group {
		margin-bottom: 16px;
	}
	.domain-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 4px;
		position: sticky;
		top: 0;
		background: var(--background-primary);
		z-index: 1;
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
	.domain-name.dim,
	.project-name.dim {
		opacity: 0.55;
	}
	.domain-count {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
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
		padding: 2px 0;
		cursor: pointer;
		text-align: left;
	}
	.project-name:hover {
		color: var(--interactive-accent);
	}
	.name-input {
		font-size: 13px;
		color: var(--text-normal);
		background: var(--background-primary);
		border: 1px solid var(--interactive-accent);
		border-radius: 5px;
		padding: 2px 6px;
		min-width: 160px;
	}

	/* ── Icon buttons ── */
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 24px;
		width: 24px;
		border: 1px solid transparent;
		border-radius: 6px;
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
	}
	.icon-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.icon-btn.danger:hover {
		color: var(--text-error, #e05555);
		border-color: var(--text-error, #e05555);
	}
	.color-btn .swatch {
		width: 13px;
		height: 13px;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
	}

	/* ── Chips (domain link) ── */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 8px;
		font-size: 11px;
		font-weight: 500;
		border: 1px solid var(--background-modifier-border);
		border-radius: 11px;
		background: var(--background-primary-alt);
		color: var(--text-normal);
		cursor: pointer;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.chip:hover {
		background: var(--background-modifier-hover);
	}
	.domain-chip.ghost {
		color: var(--text-faint);
		padding: 0 6px;
	}

	/* ── Popups ── */
	.popup {
		position: absolute;
		top: calc(100% + 4px);
		right: 8px;
		z-index: 100;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: var(--shadow-s);
		padding: 8px;
	}
	.color-popup {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 168px;
	}
	.palette {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 4px;
	}
	.palette-swatch {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
		cursor: pointer;
		padding: 0;
	}
	.color-input {
		width: 100%;
		height: 26px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary-alt);
		cursor: pointer;
	}
	.clear-link {
		font-size: 11px;
		color: var(--text-muted);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: 0;
	}
	.clear-link:hover {
		color: var(--text-error, #e05555);
	}
	.status-popup {
		display: flex;
		flex-direction: column;
		min-width: 110px;
		padding: 4px;
	}
	.status-opt {
		font-size: 12px;
		color: var(--text-normal);
		background: transparent;
		border: none;
		border-radius: 5px;
		padding: 6px 10px;
		text-align: left;
		cursor: pointer;
	}
	.status-opt:hover {
		background: var(--background-modifier-hover);
	}
	.status-opt.sel {
		color: var(--interactive-accent);
		font-weight: 600;
	}
	.status-note {
		font-size: 10px;
		color: var(--text-faint);
		font-style: italic;
		padding: 4px 10px 2px;
	}
	.domain-popup {
		display: flex;
		flex-direction: column;
		min-width: 150px;
		max-height: 260px;
		overflow: auto;
		padding: 4px;
	}
	.domain-popup .status-opt {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.opt-swatch {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		flex-shrink: 0;
	}
</style>
