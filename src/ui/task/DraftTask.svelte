<script lang="ts">
	// A task row that isn't a task yet. A "+" opens one
	// instead of making a "New task" straight away, so nothing is written until
	// it has a name. Enter adds the task and leaves the row open, empty, for the
	// next one; Escape, or Enter on an empty row, closes it. Leaving it (a click
	// elsewhere, or the list around it closing) adds what was typed. It's the
	// shared item row, lit as new, with an empty box for the lead.

	import { onMount } from "svelte";
	import TaskCheckbox from "./TaskCheckbox.svelte";
	import ItemRow from "../components/ItemRow.svelte";

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

	// What was last added, and when. A phone keyboard can hand the same text
	// over twice: "Go" arrives as Enter while the word is still being composed,
	// the row adds it and empties, then the keyboard commits the word back into
	// the field and closing it blurs the row, which added it again. The same
	// text again within a moment is that echo, not a second task.
	let last: { text: string; at: number } | null = null;
	const ECHO_MS = 1000;

	function submit(): boolean {
		const next = text.trim();
		text = "";
		if (inputEl) inputEl.value = "";
		if (next === "") return false;
		const now = Date.now();
		if (last && last.text === next && now - last.at < ECHO_MS) return true;
		last = { text: next, at: now };
		onSubmit(next);
		return true;
	}

	function onKeydown(e: KeyboardEvent) {
		// Enter that ends a composition (an accent, a phone keyboard's word)
		// belongs to the keyboard; the next Enter adds the task.
		if (e.isComposing) return;
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

{#snippet box()}
	<TaskCheckbox status=" " {color} inert />
{/snippet}

<ItemRow square lit="new" {color} lead={box}>
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
</ItemRow>

<style>
	/* Typed in place, like ItemText's editor. */
	.k-draft-input {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0;
		font-family: inherit;
		font-size: var(--kairos-item-text-size, var(--kairos-text-body));
		line-height: 1.4;
		color: var(--text-normal);
	}
	.k-draft-input::placeholder {
		color: var(--text-faint);
	}
</style>
