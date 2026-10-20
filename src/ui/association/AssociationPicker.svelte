<script lang="ts">
	// A searchable association combo box.
	//
	// Floats at an anchor rect, filters non-archived projects + domains as you
	// type, and reports the chosen association (or null to clear) through
	// `onPick`. Purely presentational: the caller supplies the options and owns
	// what "pick" does (write the tag, close, etc.). Keyboard: type to filter,
	// ↑/↓ to move, Enter to choose the highlighted row, Escape to cancel.
	//
	// With `create`, a typed name nothing matches is offered as a new project
	// or domain after the matches, so a task can be filed under something that
	// doesn't exist yet without leaving the picker.

	import { onMount, tick } from "svelte";
	import type { Association } from "../../types";
	import {
		filterOptions,
		newNameProblem,
		offersCreate,
		type AssociationOption,
	} from "../../associationOptions";

	// Render the panel under document.body. Obsidian leaf containers often have a
	// CSS transform, which makes `position: fixed` resolve against that ancestor
	// instead of the viewport — sending the panel off-screen. Portaling to body
	// escapes any transformed ancestor so `fixed` matches viewport coordinates.
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			},
		};
	}

	interface Props {
		// All pickable options (from index.associationOptions()).
		options: AssociationOption[];
		// The currently-applied association, if any — shown as selected + offers
		// a "Clear" affordance.
		current?: Association;
		// Screen rect to anchor the popup under (typically the trigger's bounds).
		anchor: DOMRect;
		// Chosen association, or null to clear. Caller closes the popup.
		onPick: (association: Association | null) => void;
		// Dismissed without choosing (outside click / Escape).
		onClose: () => void;
		// Make a new project or domain named `name`; resolves to its association,
		// or null if it couldn't be made (the callee says why). Omit to offer
		// only existing ones.
		create?: (kind: Association["kind"], name: string) => Promise<Association | null>;
	}

	let { options, current, anchor, onPick, onClose, create }: Props = $props();

	let query = $state("");
	let inputEl = $state<HTMLInputElement>();
	let panelEl = $state<HTMLDivElement>();
	let highlighted = $state(0);

	const filtered = $derived(filterOptions(options, query));

	// The "Create project/domain" rows, after the matches. A name that can't be
	// used shows why in their place.
	const offering = $derived(create !== undefined && offersCreate(options, query));
	const createProblem = $derived(offering ? newNameProblem(query) : null);
	const createKinds = $derived<Association["kind"][]>(
		offering && !createProblem ? ["project", "domain"] : [],
	);
	const rowCount = $derived(filtered.length + createKinds.length);

	// Keep the highlight in range as the list shrinks/grows while typing.
	$effect(() => {
		if (highlighted >= rowCount) highlighted = Math.max(0, rowCount - 1);
	});

	function isCurrent(o: AssociationOption): boolean {
		return (
			current !== undefined &&
			current.kind === o.association.kind &&
			current.id === o.association.id
		);
	}

	function choose(o: AssociationOption) {
		onPick(o.association);
	}

	function clear() {
		onPick(null);
	}

	// One create at a time: a double Enter mustn't make the file twice.
	let creatingNow = false;
	async function createAs(kind: Association["kind"]) {
		if (!create || creatingNow) return;
		creatingNow = true;
		const made = await create(kind, query);
		creatingNow = false;
		if (made) onPick(made);
	}

	function chooseRow(i: number) {
		const option = filtered[i];
		if (option) choose(option);
		else {
			const kind = createKinds[i - filtered.length];
			if (kind) void createAs(kind);
		}
	}

	function onKeydown(event: KeyboardEvent) {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				if (rowCount) highlighted = (highlighted + 1) % rowCount;
				break;
			case "ArrowUp":
				event.preventDefault();
				if (rowCount) highlighted = (highlighted - 1 + rowCount) % rowCount;
				break;
			case "Enter": {
				event.preventDefault();
				chooseRow(highlighted);
				break;
			}
			case "Escape":
				event.preventDefault();
				onClose();
				break;
		}
	}

	// Position the panel just under the anchor, flipping above if it would
	// overflow the viewport bottom. Uses fixed positioning (anchor is a screen
	// rect), so it isn't clipped by scrolling ancestors.
	let style = $state("");
	function place() {
		const width = 240;
		const margin = 6;
		const left = Math.min(
			anchor.left,
			window.innerWidth - width - margin,
		);
		const below = anchor.bottom + margin;
		const panelH = panelEl?.offsetHeight ?? 260;
		const flipUp = below + panelH > window.innerHeight && anchor.top > panelH;
		const top = flipUp ? anchor.top - margin - panelH : below;
		style = `left:${Math.max(margin, left)}px; top:${Math.max(margin, top)}px; width:${width}px;`;
	}

	onMount(() => {
		void tick().then(() => {
			place();
			inputEl?.focus();
		});

		// Dismiss on any outside pointer press.
		const onDocPointer = (e: PointerEvent) => {
			if (panelEl && !panelEl.contains(e.target as Node)) onClose();
		};
		// Defer so the opening click doesn't immediately close it.
		const id = window.setTimeout(
			() => document.addEventListener("pointerdown", onDocPointer, true),
			0,
		);
		const onResize = () => place();
		window.addEventListener("resize", onResize);

		return () => {
			window.clearTimeout(id);
			document.removeEventListener("pointerdown", onDocPointer, true);
			window.removeEventListener("resize", onResize);
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="assoc-picker"
	use:portal
	bind:this={panelEl}
	{style}
	onpointerdown={(e) => e.stopPropagation()}
	onkeydown={onKeydown}
>
	<input
		class="assoc-search"
		type="text"
		placeholder="Search projects & domains…"
		bind:value={query}
		bind:this={inputEl}
	/>

	<div class="assoc-list" role="listbox" aria-label="Associations">
		{#if current}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div class="assoc-row assoc-clear" role="option" aria-selected="false" onclick={clear}>
				<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
				<span>Clear association</span>
			</div>
		{/if}

		{#if rowCount === 0 && !createProblem}
			<div class="assoc-empty">No matches</div>
		{:else}
			{#each filtered as option, i (option.kind + ":" + option.name)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_interactive_supports_focus -->
				<div
					class="assoc-row"
					class:highlighted={i === highlighted}
					class:selected={isCurrent(option)}
					class:inactive={option.status === "inactive"}
					role="option"
					aria-selected={isCurrent(option)}
					onmouseenter={() => (highlighted = i)}
					onclick={() => choose(option)}
				>
					{#if option.kind === "domain"}
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/></svg>
					{/if}
					<span class="assoc-name">{option.name}</span>
					{#if option.status === "inactive"}
						<span class="assoc-badge">inactive</span>
					{/if}
				</div>
			{/each}
			{#each createKinds as kind, k (kind)}
				{@const i = filtered.length + k}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_interactive_supports_focus -->
				<div
					class="assoc-row assoc-create"
					class:highlighted={i === highlighted}
					role="option"
					aria-selected="false"
					onmouseenter={() => (highlighted = i)}
					onclick={() => void createAs(kind)}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
					<span class="assoc-name">Create {kind} “{query.trim()}”</span>
				</div>
			{/each}
			{#if createProblem}
				<div class="assoc-empty">{createProblem}</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.assoc-picker {
		position: fixed;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: var(--shadow-s);
		overflow: hidden;
	}

	.assoc-search {
		margin: 8px;
		padding: 5px 8px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 5px;
		background: var(--background-primary-alt);
		color: var(--text-normal);
		font-size: 13px;
	}

	.assoc-search:focus {
		outline: none;
		border-color: var(--interactive-accent);
	}

	.assoc-list {
		max-height: 240px;
		overflow-y: auto;
		padding: 0 4px 6px;
	}

	.assoc-row {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 8px;
		border-radius: 5px;
		font-size: 13px;
		color: var(--text-normal);
		cursor: pointer;
	}

	.assoc-row.highlighted {
		background: var(--background-modifier-hover);
	}

	.assoc-row.selected {
		font-weight: 600;
	}

	.assoc-row.inactive .assoc-name {
		color: var(--text-muted);
	}

	.assoc-row svg {
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.assoc-name {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.assoc-badge {
		flex-shrink: 0;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-faint);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		padding: 0 4px;
	}

	.assoc-clear {
		color: var(--text-muted);
	}

	.assoc-create {
		color: var(--text-muted);
	}

	.assoc-create.highlighted {
		color: var(--text-normal);
	}

	.assoc-empty {
		padding: 8px;
		font-size: 12px;
		color: var(--text-muted);
		text-align: center;
	}
</style>
