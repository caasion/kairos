<script lang="ts">
	// The right-hand pane of the Projects & domains view: everything about the
	// selected project or domain, laid out as Obsidian's own settings page (a
	// `setting-group` of rows under a heading). Its name, description, domain
	// and Grid rollup (projects) or colour (domains), its status, and its status
	// history.
	//
	// The history lists every change, newest first. Selecting one opens it in
	// its own dialog (StatusRecordModal) to edit or delete; **Add change** opens
	// the same dialog empty. Every write goes through projectActions, whose pure
	// edit functions own the history's invariants; the view re-resolves the
	// entity from the live feed, so this pane refreshes after each one.

	import type { App } from "obsidian";
	import type { Domain, ISODate, LifecycleState, Project, StatusRecord } from "../../types";
	import type { KairosIndex } from "../../index";
	import {
		editDomainStatusRecord,
		editProjectStatusRecord,
		removeDomainStatusRecord,
		removeProjectStatusRecord,
		setDomainColor,
		setDomainDescription,
		setDomainStatus,
		setProjectDescription,
		setProjectDomain,
		setProjectRollup,
		setProjectStatus,
	} from "../../projectActions";
	import { dateFromISO, todayISO } from "../../dayNote";
	import { effectiveStatus, INTENSITY_MAX } from "../../projectFile";
	import IconButton from "../components/IconButton.svelte";
	import IntensityBars from "../components/IntensityBars.svelte";
	import Tag from "../components/Tag.svelte";
	import { icon } from "../actions/icon";
	import { StatusRecordModal, type RecordDraft } from "./StatusRecordModal";

	interface Props {
		app: App;
		index: KairosIndex;
		entity: Project | Domain;
		isDomain: boolean;
		/** Every domain, in page order, for a project's Domain dropdown. */
		domains: Domain[];
		/** A project under an inactive domain: shown, but nothing can change. */
		readonly: boolean;
		/** Rename, with the view's collision check. */
		onRename: (name: string) => void;
		/** Change today's status, and ask why if it went inactive or archived. */
		onSetStatus: (status: LifecycleState) => void;
		onOpenFile: () => void;
		onBacklog: () => void;
		onMenu: (event: MouseEvent) => void;
		/** Back to the list, when the view is too narrow for both panes. */
		onBack: () => void;
	}

	let {
		app,
		index,
		entity,
		isDomain,
		domains,
		readonly,
		onRename,
		onSetStatus,
		onOpenFile,
		onBacklog,
		onMenu,
		onBack,
	}: Props = $props();

	const STATUS_LABEL: Record<LifecycleState, string> = {
		active: "Active",
		inactive: "Inactive",
		archived: "Archived",
	};

	// Domains are durable: they never archive.
	const states = $derived<LifecycleState[]>(
		isDomain ? ["active", "inactive"] : ["active", "inactive", "archived"],
	);
	const status = $derived(effectiveStatus(entity.history, todayISO()));
	const project = $derived(isDomain ? null : (entity as Project));
	const domain = $derived(isDomain ? (entity as Domain) : null);
	const color = $derived(
		domain?.color || domains.find((d) => d.id === project?.domain)?.color || undefined,
	);

	function formatDate(date: ISODate): string {
		return dateFromISO(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	// Text fields write when they lose focus or on Enter, not on every key.
	function commitOnEnter(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (e.key === "Enter") e.currentTarget.blur();
	}
	function commitName(value: string) {
		const next = value.trim();
		if (next !== "" && next !== entity.name) onRename(next);
	}
	function commitDescription(value: string) {
		const next = value.trim();
		if (next === entity.description) return;
		if (domain) setDomainDescription(index, domain, next);
		else if (project) setProjectDescription(index, project, next);
	}

	// ── Status history ──
	function addChange() {
		new StatusRecordModal(app, {
			name: entity.name,
			states,
			onSave: (d: RecordDraft) => {
				if (domain) setDomainStatus(index, domain, d.date, d.status, d.note, d.why, d.intensity);
				else if (project)
					setProjectStatus(index, project, d.date, d.status, d.note, d.why, d.intensity);
			},
		}).open();
	}

	function editChange(rec: StatusRecord) {
		if (readonly) return;
		new StatusRecordModal(app, {
			name: entity.name,
			states,
			initial: rec,
			onSave: (d: RecordDraft) => {
				// Note and why are always written, so an emptied field clears them.
				// Intensity is only the form's while the record is active, so an
				// inactive edit leaves what's stored alone.
				const next = {
					date: d.date,
					status: d.status,
					note: d.note,
					why: d.why,
					...(d.status === "active" ? { intensity: d.intensity } : {}),
				};
				if (domain) editDomainStatusRecord(index, domain, rec.date, next);
				else if (project) editProjectStatusRecord(index, project, rec.date, next);
			},
			onDelete: () => {
				if (domain) removeDomainStatusRecord(index, domain, rec.date);
				else if (project) removeProjectStatusRecord(index, project, rec.date);
			},
		}).open();
	}
</script>

<div class="kairos-detail" style:--ag-color={color}>
	<div class="kairos-detail-head">
		<span class="kairos-detail-back">
			<IconButton label="Back to the list" icon="arrow-left" size="m" onclick={onBack} />
		</span>
		<span
			class="kairos-detail-icon"
			use:icon={isDomain ? "presentation" : "folder-symlink"}
		></span>
		<span class="kairos-detail-name">{entity.name}</span>
		{#if status !== "active"}<Tag>{STATUS_LABEL[status]}</Tag>{/if}
		<span class="kairos-detail-spacer"></span>
		<IconButton label="Open note" icon="file-text" size="m" onclick={onOpenFile} />
		<IconButton label="View backlog" icon="inbox" size="m" onclick={onBacklog} />
		<IconButton
			label="More actions"
			icon="more-horizontal"
			size="m"
			disabled={readonly}
			onclick={onMenu}
		/>
	</div>

	{#if readonly}
		<p class="kairos-detail-note">Its domain is inactive, so nothing here can change.</p>
	{/if}

	<fieldset class="kairos-detail-fields" disabled={readonly}>
		<div class="setting-group">
			<div class="setting-items">
				<div class="setting-item">
					<div class="setting-item-info"><div class="setting-item-name">Name</div></div>
					<div class="setting-item-control">
						{#key entity.name}
							<input
								type="text"
								value={entity.name}
								onblur={(e) => commitName(e.currentTarget.value)}
								onkeydown={commitOnEnter}
							/>
						{/key}
					</div>
				</div>
				<div class="setting-item">
					<div class="setting-item-info">
						<div class="setting-item-name">Description</div>
						<div class="setting-item-description">A short line shown beside the name.</div>
					</div>
					<div class="setting-item-control">
						{#key entity.description}
							<input
								type="text"
								placeholder="Optional"
								value={entity.description}
								onblur={(e) => commitDescription(e.currentTarget.value)}
								onkeydown={commitOnEnter}
							/>
						{/key}
					</div>
				</div>
				{#if project}
					<div class="setting-item">
						<div class="setting-item-info"><div class="setting-item-name">Domain</div></div>
						<div class="setting-item-control">
							<select
								class="dropdown"
								value={project.domain ?? ""}
								onchange={(e) =>
									setProjectDomain(index, project, e.currentTarget.value || undefined)}
							>
								<option value="">None</option>
								{#each domains as d (d.id)}
									<option value={d.id}>{d.name}</option>
								{/each}
							</select>
						</div>
					</div>
					{#if project.domain}
						<div class="setting-item mod-toggle">
							<div class="setting-item-info">
								<div class="setting-item-name">Show on its domain's row</div>
								<div class="setting-item-description">
									In the Grid, its tasks sit on the domain's row instead of a row of their own.
								</div>
							</div>
							<div class="setting-item-control">
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="checkbox-container"
									class:is-enabled={project.rollup}
									onclick={() => !readonly && setProjectRollup(index, project, !project.rollup)}
								>
									<input type="checkbox" checked={project.rollup ?? false} tabindex="0" />
								</div>
							</div>
						</div>
					{/if}
				{:else if domain}
					<div class="setting-item">
						<div class="setting-item-info">
							<div class="setting-item-name">Color</div>
							<div class="setting-item-description">Marks the domain and its projects in every view.</div>
						</div>
						<div class="setting-item-control">
							<input
								type="color"
								value={domain.color || "#888888"}
								onchange={(e) => setDomainColor(index, domain, e.currentTarget.value)}
							/>
						</div>
					</div>
				{/if}
				<div class="setting-item">
					<div class="setting-item-info">
						<div class="setting-item-name">Status</div>
						<div class="setting-item-description">Changing it adds a change dated today.</div>
					</div>
					<div class="setting-item-control">
						<select
							class="dropdown"
							value={status}
							onchange={(e) => onSetStatus(e.currentTarget.value as LifecycleState)}
						>
							{#each states as s (s)}
								<option value={s}>{STATUS_LABEL[s]}</option>
							{/each}
						</select>
					</div>
				</div>
			</div>
		</div>

		<div class="setting-group">
			<div class="setting-item setting-item-heading">
				<div class="setting-item-info"><div class="setting-item-name">Status history</div></div>
				<div class="setting-item-control">
					<button onclick={addChange}>Add change</button>
				</div>
			</div>
			<div class="setting-items">
				{#if entity.history.length === 0}
					<div class="setting-item">
						<div class="setting-item-info">
							<div class="setting-item-description">
								No changes recorded yet, so it counts as active.
							</div>
						</div>
					</div>
				{:else}
					{@const today = todayISO()}
					{@const effective = entity.history.filter((r) => r.date <= today).at(-1)}
					{#each [...entity.history].reverse() as rec (rec.date)}
						<div
							class="setting-item kairos-change"
							role="button"
							tabindex="0"
							aria-label="Edit this change"
							onclick={() => editChange(rec)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									editChange(rec);
								}
							}}
						>
							<div class="setting-item-info">
								<div class="setting-item-name kairos-change-line">
									<span class="kairos-change-dot" data-status={rec.status}></span>
									{STATUS_LABEL[rec.status]}
									{#if rec.status === "active" && rec.intensity !== undefined}
										<span
											class="kairos-change-intensity"
											title={`Intensity ${rec.intensity} of ${INTENSITY_MAX}`}
										>
											<IntensityBars level={rec.intensity} />
										</span>
									{/if}
									{#if rec === effective}<Tag tone="accent">Now</Tag>
									{:else if rec.date > today}<Tag>Scheduled</Tag>{/if}
								</div>
								<div class="setting-item-description">
									{#if rec.note}<div class="kairos-change-note">{rec.note}</div>{/if}
									<div class:kairos-change-none={!rec.why}>{rec.why || "No reason recorded"}</div>
								</div>
							</div>
							<div class="setting-item-control kairos-change-date">{formatDate(rec.date)}</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</fieldset>
</div>

<style>
	.kairos-detail {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-4);
		max-width: var(--setting-group-max-width, 700px);
		margin-inline: auto;
	}
	.kairos-detail-head {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		min-width: 0;
		padding-left: var(--size-4-3);
		border-left: var(--kairos-accent-width) solid var(--ag-color, var(--background-modifier-border));
	}
	/* Only when the view is too narrow for both panes (ProjectsView). */
	.kairos-detail-back {
		display: none;
	}
	@container kairos-projects (max-width: 640px) {
		.kairos-detail-back {
			display: flex;
		}
	}
	.kairos-detail-icon {
		--icon-size: var(--icon-s);
		display: flex;
		flex-shrink: 0;
		color: var(--ag-color, var(--text-muted));
	}
	.kairos-detail-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--kairos-font-serif);
		font-size: var(--font-ui-large);
		color: var(--text-normal);
	}
	.kairos-detail-spacer {
		flex: 1;
	}
	.kairos-detail-note {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}
	.kairos-detail-fields {
		border: none;
		margin: 0;
		padding: 0;
		min-width: 0;
	}

	/* A change in the history: a setting row you select to edit. */
	.kairos-change {
		cursor: pointer;
	}
	.kairos-change:hover {
		background-color: var(--background-modifier-hover);
	}
	.kairos-detail-fields:disabled .kairos-change {
		cursor: default;
	}
	.kairos-change-line {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
	}
	.kairos-change-dot {
		width: var(--size-4-2);
		height: var(--size-4-2);
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--text-faint);
	}
	.kairos-change-dot[data-status="active"] {
		background: var(--color-green);
	}
	.kairos-change-dot[data-status="archived"] {
		background: var(--color-red);
	}
	.kairos-change-intensity {
		display: inline-flex;
		color: var(--text-muted);
	}
	.kairos-change-note {
		color: var(--text-normal);
	}
	.kairos-change-none {
		color: var(--text-faint);
	}
	.kairos-change-date {
		color: var(--text-muted);
		font-size: var(--font-ui-small);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
