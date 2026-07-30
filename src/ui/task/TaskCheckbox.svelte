<script lang="ts">
	// The four-state task checkbox, ported from Holos.
	//
	// Click cycles forward through the everyday states:
	//   open ( ) → half (/) → done (x) → open ( )
	// A long-press (500ms) cancels the task (-). Cancelled cycles back to open
	// on a normal click like any other non-open state.
	//
	// This component only reports intent through `onToggle` / `onCancel`; the
	// parent owns persistence. It's shared by plain tasks and checkable block
	// headers so the checkbox looks and behaves identically everywhere.

	import type { TaskStatus } from "../../types";
	import { longpress } from "../actions/longpress";

	interface Props {
		status: TaskStatus;
		onToggle: () => void;
		onCancel: () => void;
	}

	let { status, onToggle, onCancel }: Props = $props();

	// Unique clip-path id per instance so multiple half-done checkboxes don't
	// share (and clobber) one another's SVG clip.
	const clipId = `k-half-${Math.random().toString(36).slice(2, 8)}`;

	let buttonEl = $state<HTMLButtonElement>();

	$effect(() => {
		const el = buttonEl;
		if (!el) return;
		const handler = () => onCancel();
		el.addEventListener("longpress", handler);
		return () => el.removeEventListener("longpress", handler);
	});

	const title = $derived(
		status === " "
			? "Mark half-done"
			: status === "/"
				? "Mark done"
				: status === "x"
					? "Mark open"
					: "Cancelled",
	);
</script>

<button
	bind:this={buttonEl}
	type="button"
	class="k-checkbox"
	class:open={status === " "}
	class:partial={status === "/"}
	class:checked={status === "x"}
	class:cancelled={status === "-"}
	onclick={onToggle}
	use:longpress={500}
	{title}
	aria-label={title}
>
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
		<rect x="1" y="1" width="14" height="14" rx="3" ry="3" class="cb-border" />

		{#if status === "/"}
			<defs>
				<clipPath id={clipId}>
					<rect x="0" y="8" width="16" height="8" />
				</clipPath>
			</defs>
			<rect
				x="1" y="1" width="14" height="14" rx="3" ry="3"
				class="cb-partial-fill"
				clip-path="url(#{clipId})"
			/>
			<line x1="11.5" y1="3.5" x2="4.5" y2="12.5" class="cb-slash" />
		{:else if status === "x"}
			<rect x="1" y="1" width="14" height="14" rx="3" ry="3" class="cb-checked-fill" />
			<polyline points="4.5,8.5 7,11 11.5,5.5" class="cb-checkmark" />
		{:else if status === "-"}
			<rect x="1" y="1" width="14" height="14" rx="3" ry="3" class="cb-cancelled-fill" />
			<line x1="4.5" y1="8" x2="11.5" y2="8" class="cb-cancelled-dash" />
		{/if}
	</svg>
</button>

<style>
	.k-checkbox {
		cursor: pointer;
		background: transparent;
		border: none;
		padding: 0;
		margin: 0;
		box-shadow: none;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.k-checkbox:hover {
		box-shadow: none;
		opacity: 0.85;
	}

	.cb-border {
		fill: none;
		stroke: var(--checkbox-border-color, var(--interactive-accent));
		stroke-width: 1.5;
	}

	.checked .cb-border,
	.cancelled .cb-border {
		stroke: transparent;
	}

	.cb-partial-fill {
		fill: var(--interactive-accent);
	}

	.cb-slash {
		stroke: var(--text-on-accent, #fff);
		stroke-width: 1.8;
		stroke-linecap: round;
		fill: none;
	}

	.cb-checked-fill {
		fill: var(--interactive-accent);
	}

	.cb-checkmark {
		fill: none;
		stroke: var(--text-on-accent, #fff);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.cb-cancelled-fill {
		fill: var(--text-faint, #999);
	}

	.cb-cancelled-dash {
		stroke: var(--background-primary, #fff);
		stroke-width: 2;
		stroke-linecap: round;
	}
</style>
