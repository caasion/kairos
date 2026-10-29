<script lang="ts">
	// PROTOTYPE (add flow): a task row that isn't a task yet. A "+" opens one
	// instead of making a "New task" straight away, so nothing is written until
	// it has a name. Enter adds the task and leaves the row open, empty, for the
	// next one; Escape, or Enter on an empty row, closes it. Leaving it (a click
	// elsewhere, or the list around it closing) adds what was typed.

	import { onMount } from "svelte";

	interface Props {
		// The row's domain color, for the empty box and the tint.
		color?: string;
		placeholder?: string;
		onSubmit: (text: string) => void;
		onClose: () => void;
	}

	let { color, placeholder = "New task", onSubmit, onClose }: Props = $props();

	let text = $state("");
	let inputEl = $state<HTMLInputElement>();

	function submit(): boolean {
		const next = text.trim();
		text = "";
		if (next === "") return false;
		onSubmit(next);
		return true;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			if (!submit()) onClose();
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			text = "";
			onClose();
		}
	}

	function onBlur() {
		submit();
		onClose();
	}

	onMount(() => {
		inputEl?.focus();
		// Removed while focused (its list closed on a click outside): the blur
		// may never fire, so add what was typed here.
		return () => submit();
	});
</script>

<div class="k-draft" style={color ? `--k-draft-color: ${color};` : undefined}>
	<svg class="k-draft-box" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
		<rect x="1" y="1" width="14" height="14" rx="3" ry="3" />
	</svg>
	<input
		class="k-draft-input kairos-inline-input"
		type="text"
		{placeholder}
		aria-label={placeholder}
		bind:value={text}
		bind:this={inputEl}
		onkeydown={onKeydown}
		onblur={onBlur}
		onpointerdown={(e) => e.stopPropagation()}
		onclick={(e) => e.stopPropagation()}
	/>
</div>

<style>
	/* Tinted in the row's color, like a lit task, so it reads as the new one. */
	.k-draft {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 2px 4px;
		background: color-mix(in srgb, var(--k-draft-color, var(--interactive-accent)) 12%, transparent);
		box-shadow: inset 2px 0 0 var(--k-draft-color, var(--interactive-accent));
	}
	.k-draft-box {
		flex-shrink: 0;
		fill: none;
		stroke: var(--k-draft-color, var(--interactive-accent));
		stroke-width: 1.5;
		opacity: 0.7;
	}
	.k-draft-input {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0;
		font-family: inherit;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-normal);
	}
	.k-draft-input::placeholder {
		color: var(--text-faint);
	}
</style>
