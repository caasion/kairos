<script lang="ts">
	// A searchable block combo box — the "nest task under block" picker.
	//
	// Floats at an anchor rect, filters the day's blocks as you type, and reports
	// the chosen block through `onPick`. Purely presentational: the caller supplies
	// the options and owns what "pick" does (perform the nest, close, etc.).
	// Keyboard: type to filter, ↑/↓ to move, Enter to choose, Escape to cancel.
	//
	// A deliberate sibling of AssociationPicker — same portal/anchor/keyboard
	// machinery — so the two feel identical and the grid can reuse this later.

	import { onMount, tick } from "svelte";
	import {
		filterBlockOptions,
		type BlockOption,
	} from "../../blockOptions";

	// Portal to body so `position: fixed` resolves against the viewport, not a
	// transformed leaf-container ancestor (see AssociationPicker for the why).
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			},
		};
	}

	interface Props {
		// The day's blocks as options (from blockOptions(), typically with the
		// task's current owner excluded).
		options: BlockOption[];
		// Screen rect to anchor the popup under (typically the trigger's bounds).
		anchor: DOMRect;
		// The chosen block. Caller closes the popup.
		onPick: (option: BlockOption) => void;
		// Dismissed without choosing (outside click / Escape).
		onClose: () => void;
	}

	let { options, anchor, onPick, onClose }: Props = $props();

	let query = $state("");
	let inputEl = $state<HTMLInputElement>();
	let panelEl = $state<HTMLDivElement>();
	let highlighted = $state(0);

	const filtered = $derived(filterBlockOptions(options, query));

	// Keep the highlight in range as the list shrinks/grows while typing.
	$effect(() => {
		filtered;
		if (highlighted >= filtered.length)
			highlighted = Math.max(0, filtered.length - 1);
	});

	function choose(o: BlockOption) {
		onPick(o);
	}

	function onKeydown(event: KeyboardEvent) {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				if (filtered.length) highlighted = (highlighted + 1) % filtered.length;
				break;
			case "ArrowUp":
				event.preventDefault();
				if (filtered.length)
					highlighted = (highlighted - 1 + filtered.length) % filtered.length;
				break;
			case "Enter": {
				event.preventDefault();
				const pick = filtered[highlighted];
				if (pick) choose(pick);
				break;
			}
			case "Escape":
				event.preventDefault();
				onClose();
				break;
		}
	}

	// Position the panel just under the anchor, flipping above if it would
	// overflow the viewport bottom. Fixed positioning against a screen rect.
	let style = $state("");
	function place() {
		const width = 240;
		const margin = 6;
		const left = Math.min(anchor.left, window.innerWidth - width - margin);
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
	class="block-picker"
	use:portal
	bind:this={panelEl}
	{style}
	onpointerdown={(e) => e.stopPropagation()}
	onkeydown={onKeydown}
>
	<input
		class="block-search"
		type="text"
		placeholder="Nest under block…"
		bind:value={query}
		bind:this={inputEl}
	/>

	<div class="block-list" role="listbox" aria-label="Blocks">
		{#if filtered.length === 0}
			<div class="block-empty">No blocks</div>
		{:else}
			{#each filtered as option, i (option.block.source.line)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_interactive_supports_focus -->
				<div
					class="block-row"
					class:highlighted={i === highlighted}
					role="option"
					aria-selected={i === highlighted}
					onmouseenter={() => (highlighted = i)}
					onclick={() => choose(option)}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 8h6"/><path d="M9 12h6"/></svg>
					<span class="block-name">{option.title}</span>
					{#if option.timeLabel}
						<span class="block-time">{option.timeLabel}</span>
					{:else}
						<span class="block-badge">unscheduled</span>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.block-picker {
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

	.block-search {
		margin: 8px;
		padding: 5px 8px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 5px;
		background: var(--background-primary-alt);
		color: var(--text-normal);
		font-size: 13px;
	}

	.block-search:focus {
		outline: none;
		border-color: var(--interactive-accent);
	}

	.block-list {
		max-height: 240px;
		overflow-y: auto;
		padding: 0 4px 6px;
	}

	.block-row {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 8px;
		border-radius: 5px;
		font-size: 13px;
		color: var(--text-normal);
		cursor: pointer;
	}

	.block-row.highlighted {
		background: var(--background-modifier-hover);
	}

	.block-row svg {
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.block-name {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.block-time {
		flex-shrink: 0;
		font-size: 10px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.block-badge {
		flex-shrink: 0;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-faint);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		padding: 0 4px;
	}

	.block-empty {
		padding: 8px;
		font-size: 12px;
		color: var(--text-muted);
		text-align: center;
	}
</style>
