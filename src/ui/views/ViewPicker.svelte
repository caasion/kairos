<script lang="ts">
	// The body of the view picker (issue #17): the six Kairos views as a list of
	// rows, each carrying the view's own ribbon/tab icon, its name and one line
	// saying what it is for. The ribbon used to hold six icons; this list is what
	// replaced them, so it is also the discovery surface — a new user who has
	// never opened the command palette still learns that a Grid and a Timeline
	// exist by opening it once.
	//
	// Purely presentational: picking a row forwards to `onPick` and the modal
	// wrapper (ViewPickerModal) closes itself and activates the view. Styling is
	// scoped here rather than in styles.css, so the picker carries its own
	// appearance and nothing else in the plugin has to know about it.

	import { setIcon } from "obsidian";
	import type { ViewPickerEntry } from "./ViewPickerModal";

	interface Props {
		entries: ViewPickerEntry[];
		/** Chosen a view — the wrapper closes the modal and opens it. */
		onPick: (entry: ViewPickerEntry) => void;
	}

	let { entries, onPick }: Props = $props();

	let listEl: HTMLElement | undefined = $state();

	// Focus the first row so the keyboard works the moment the modal opens —
	// Enter picks, arrows move. Deferred a tick because Obsidian sets its own
	// focus as the modal opens — the same reason PromptModal defers its focus.
	$effect(() => {
		const el = listEl;
		if (!el) return;
		const id = window.setTimeout(() => {
			el.querySelector<HTMLButtonElement>(".view-picker-row")?.focus();
		}, 0);
		return () => window.clearTimeout(id);
	});

	/** Render a Lucide icon by name, the same way Obsidian renders it elsewhere. */
	function icon(el: HTMLElement, name: string) {
		setIcon(el, name);
		return {
			update(next: string) {
				el.empty();
				setIcon(el, next);
			},
		};
	}

	// Up/Down cycle through the rows. Tab still walks them in order; this just
	// makes the list behave like a list once the first row has focus.
	function moveFocus(event: KeyboardEvent) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const current = event.currentTarget as HTMLButtonElement;
		const rows = Array.from(
			current.parentElement?.querySelectorAll<HTMLButtonElement>(
				".view-picker-row",
			) ?? [],
		);
		const i = rows.indexOf(current);
		if (i < 0 || rows.length === 0) return;
		event.preventDefault();
		const step = event.key === "ArrowDown" ? 1 : rows.length - 1;
		rows[(i + step) % rows.length]?.focus();
	}
</script>

<div class="view-picker" bind:this={listEl}>
	{#each entries as entry (entry.name)}
		<button
			class="view-picker-row"
			type="button"
			onclick={() => onPick(entry)}
			onkeydown={moveFocus}
		>
			<span class="view-picker-icon" use:icon={entry.icon}></span>
			<span class="view-picker-label">
				<span class="view-picker-name">{entry.name}</span>
				<span class="view-picker-blurb">{entry.blurb}</span>
			</span>
		</button>
	{/each}
</div>

<style>
	.view-picker {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.view-picker-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: 6px;
		box-shadow: none;
		background: transparent;
		color: var(--text-normal);
		text-align: left;
		cursor: pointer;
		height: auto;
	}
	/* `:focus`, not `:focus-visible` — the first row is focused when the modal
	   opens, so Enter always has a target and the target is always visible. */
	.view-picker-row:hover,
	.view-picker-row:focus {
		background: var(--background-modifier-hover);
		box-shadow: none;
	}

	.view-picker-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--text-muted);
	}
	.view-picker-row:hover .view-picker-icon,
	.view-picker-row:focus .view-picker-icon {
		color: var(--text-normal);
	}
	.view-picker-icon :global(svg) {
		width: 18px;
		height: 18px;
	}

	.view-picker-label {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.view-picker-name {
		font-size: var(--font-ui-medium);
		line-height: 1.3;
		color: var(--text-normal);
	}

	/* Muted via a colour token, never opacity — these rows sit inside a modal
	   that may already be dimmed, and stacked opacity multiplies. */
	.view-picker-blurb {
		font-size: var(--font-ui-smaller);
		line-height: 1.35;
		color: var(--text-muted);
	}
</style>
