<script lang="ts">
	// A few choices side by side in one frame, each a click away: the selected
	// one is filled in the accent colour. Obsidian has no control like it, so
	// it's built from its colours and spacing. `isOn` decides which are lit, so
	// the same control picks one (a project's status) or toggles several (the
	// Projects view's status filter).

	interface Props {
		options: { value: string; label: string }[];
		isOn: (value: string) => boolean;
		onSelect: (value: string) => void;
		/** Names the group for screen readers. */
		label: string;
		disabled?: boolean;
	}

	let { options, isOn, onSelect, label, disabled = false }: Props = $props();
</script>

<div class="kairos-segmented" role="group" aria-label={label}>
	{#each options as o (o.value)}
		<button
			class="kairos-segmented-option"
			class:is-on={isOn(o.value)}
			aria-pressed={isOn(o.value)}
			{disabled}
			onclick={(e) => {
				e.stopPropagation();
				onSelect(o.value);
			}}>{o.label}</button
		>
	{/each}
</div>

<style>
	.kairos-segmented {
		display: inline-flex;
		flex-shrink: 0;
		gap: var(--size-2-1);
		padding: var(--size-2-1);
		background: var(--background-primary-alt);
		border: var(--border-width) solid var(--background-modifier-border);
		border-radius: var(--kairos-radius-l);
	}
	.kairos-segmented-option {
		height: auto;
		padding: var(--size-2-1) var(--size-4-2);
		border: none;
		border-radius: var(--kairos-radius-m);
		background: transparent;
		/* Obsidian's button shadow, off: the frame around the group is the edge. */
		--input-shadow: none;
		--input-shadow-hover: none;
		color: var(--text-faint);
		font-size: var(--kairos-text-label);
		font-weight: var(--font-semibold);
		cursor: pointer;
	}
	.kairos-segmented-option:hover:not(:disabled) {
		color: var(--text-muted);
	}
	.kairos-segmented-option.is-on,
	.kairos-segmented-option.is-on:hover:not(:disabled) {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}
	.kairos-segmented-option:disabled {
		cursor: default;
	}
</style>
