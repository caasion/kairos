<script lang="ts">
	// The right-hand pane of the Projects & domains view: everything about the
	// selected project or domain. The name at the top is edited in place, with
	// the description as a line under it. Below, Obsidian's own settings rows
	// (a `setting-group`) hold its domain and Grid rollup (projects) or color
	// (domains) and its status, one click each. Then the status history.
	//
	// The history is its own component (StatusHistory). Every write goes
	// through projectActions; the view re-resolves the entity from the live
	// feed, so this pane refreshes after each one.

	import type { Domain, LifecycleState, Project } from "../../types";
	import type { KairosIndex } from "../../index";
	import {
		setDomainColor,
		setDomainDescription,
		setProjectDescription,
		setProjectDomain,
		setProjectRollup,
	} from "../../projectActions";
	import { todayISO } from "../../dayNote";
	import { effectiveStatus } from "../../projectFile";
	import IconButton from "../components/IconButton.svelte";
	import SegmentedControl from "../components/SegmentedControl.svelte";
	import Tag from "../components/Tag.svelte";
	import { icon } from "../actions/icon";
	import { autogrow, singleLine } from "../actions/autogrow";
	import StatusHistory from "./StatusHistory.svelte";

	// The history text being typed over; a status change here starts on its reason.
	let typing = $state<{ part: "stretch" | "transition"; date: string } | null>(null);

	interface Props {
		index: KairosIndex;
		entity: Project | Domain;
		isDomain: boolean;
		/** Every domain, in page order, for a project's Domain dropdown. */
		domains: Domain[];
		/** A project under an inactive domain: shown, but nothing can change. */
		readonly: boolean;
		/** Rename, with the view's collision check. */
		onRename: (name: string) => void;
		/** Change today's status; true if it changed. */
		onSetStatus: (status: LifecycleState) => boolean;
		onOpenFile: () => void;
		onBacklog: () => void;
		onMenu: (event: MouseEvent) => void;
		/** Back to the list, when the view is too narrow for both panes. */
		onBack: () => void;
	}

	let {
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

	// The name and description write when they lose focus or on Enter, not on
	// every key. Escape puts back what's stored.
	function textKeys(
		e: KeyboardEvent & { currentTarget: HTMLInputElement | HTMLTextAreaElement },
		stored: string,
	) {
		if (e.key === "Enter") {
			e.preventDefault();
			e.currentTarget.blur();
		} else if (e.key === "Escape") {
			e.currentTarget.value = stored;
			e.currentTarget.blur();
		}
	}
	function commitName(field: HTMLInputElement) {
		const next = field.value.trim();
		if (next !== "" && next !== entity.name) onRename(next);
		// A refused or empty name shows the stored one again.
		field.value = entity.name;
	}
	function commitDescription(value: string) {
		const next = singleLine(value).trim();
		if (next === entity.description) return;
		if (domain) setDomainDescription(index, domain, next);
		else if (project) setProjectDescription(index, project, next);
	}

</script>

<div class="kairos-detail" style:--ag-color={color}>
	<div class="kairos-detail-head">
		<div class="kairos-detail-title">
			<span class="kairos-detail-back">
				<IconButton label="Back to the list" icon="arrow-left" size="m" onclick={onBack} />
			</span>
			<span
				class="kairos-detail-icon"
				use:icon={isDomain ? "presentation" : "folder-symlink"}
			></span>
			<input
				class="kairos-inline-input kairos-detail-name"
				type="text"
				aria-label="Name"
				value={entity.name}
				disabled={readonly}
				onblur={(e) => commitName(e.currentTarget)}
				onkeydown={(e) => textKeys(e, entity.name)}
			/>
			{#if status !== "active"}<Tag>{STATUS_LABEL[status]}</Tag>{/if}
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
		{#key entity.description}
			<textarea
				class="kairos-inline-input kairos-detail-desc"
				rows="1"
				aria-label="Description"
				placeholder="Add a description"
				value={entity.description}
				disabled={readonly}
				use:autogrow
				onblur={(e) => commitDescription(e.currentTarget.value)}
				onkeydown={(e) => textKeys(e, entity.description)}
			></textarea>
		{/key}
	</div>

	{#if readonly}
		<p class="kairos-detail-note">Its domain is inactive, so nothing here can change.</p>
	{/if}

	<fieldset class="kairos-detail-fields" disabled={readonly}>
		<div class="setting-group">
			<div class="setting-items">
				<div class="setting-item">
					<div class="setting-item-info">
						<div class="setting-item-name">Status</div>
						<div class="setting-item-description">A change takes effect today.</div>
					</div>
					<div class="setting-item-control">
						<SegmentedControl
							label="Status"
							options={states.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
							isOn={(s) => s === status}
							onSelect={(s) => {
								// The reason goes on the change, typed straight into the history.
								if (onSetStatus(s as LifecycleState) && !readonly)
									typing = { part: "transition", date: todayISO() };
							}}
							disabled={readonly}
						/>
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
			</div>
		</div>

		<StatusHistory
			bind:typing
			{index}
			{entity}
			{isDomain}
			{readonly}
			color={color ?? "var(--interactive-accent)"}
		/>
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
		flex-direction: column;
		gap: var(--size-2-2);
		min-width: 0;
		padding-left: var(--size-4-3);
		border-left: var(--kairos-accent-width) solid var(--ag-color, var(--background-modifier-border));
	}
	.kairos-detail-title {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		min-width: 0;
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
	/* The name and description read as text until you edit them; a faint fill
	   on hover says they can be. */
	.kairos-detail-name,
	.kairos-detail-desc {
		min-width: 0;
		padding: 0 var(--size-2-2);
		margin-inline: calc(-1 * var(--size-2-2));
		border-radius: var(--radius-s);
		color: var(--text-normal);
	}
	.kairos-detail-name:hover:not(:disabled, :focus),
	.kairos-detail-desc:hover:not(:disabled, :focus) {
		background: var(--background-modifier-hover);
	}
	.kairos-detail-name {
		flex: 1;
		height: auto;
		font-family: var(--kairos-font-serif);
		font-size: var(--font-ui-large);
	}
	.kairos-detail-desc {
		width: 100%;
		font-size: var(--font-ui-small);
		line-height: var(--line-height-normal);
		color: var(--text-muted);
	}
	.kairos-detail-desc::placeholder {
		color: var(--text-faint);
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

</style>
