<script lang="ts">
	// An item's text: one line with an ellipsis, or `lines` lines then an
	// ellipsis. Every item row (ItemRow) draws its text with this, so
	// tasks, leftovers, nudges and backlog entries truncate, peek and edit the
	// same way, and a change to how item text renders is made once.
	//
	// • Pointing at truncated text (or a press-and-release on touch) shows the
	//   whole of it (actions/peek.ts).
	// • With `onCommit`, a click edits it in place: Enter or leaving commits,
	//   Escape cancels. `editing` can be bound, for a list that opens an editor
	//   itself (the Backlog's new entries).
	// • With `onGrab`, a hold that then moves hands the drag to the caller; a
	//   hold that lifts in place peeks instead.
	// • Links, tags and formatting in the text are drawn (InlineText); a click
	//   on a link follows it instead of editing, and the editor shows the
	//   markdown as written.

	import { autogrow, singleLine } from "../actions/autogrow";
	import { longpress } from "../actions/longpress";
	import { movedPastSlop, peek, peekIfTruncated, type PeekOptions } from "../actions/peek";
	import { parseInline } from "../../inline";
	import InlineText from "../inline/InlineText.svelte";
	import { renderInline } from "../inline/links";

	interface Props {
		text: string;
		// How many lines it may wrap to before it's clamped. 1 keeps one line.
		lines?: number;
		// "struck" for a done or cancelled task, "half" for a half-done one.
		mark?: "struck" | "half";
		// Commit an edit: the new text on one line, untrimmed. Called on Enter
		// or blur, not on Escape. Omit for text that can't be edited here.
		onCommit?: (text: string) => void;
		editing?: boolean;
		// A hold on the text that then moves began a drag. Omit where dragging
		// isn't supported.
		onGrab?: (event: PointerEvent) => void;
		// The note the text lives in, which its links resolve from.
		sourcePath?: string;
	}

	let {
		text,
		lines = 1,
		mark,
		onCommit,
		editing = $bindable(false),
		onGrab,
		sourcePath = "",
	}: Props = $props();

	const wrapped = $derived(lines > 1);

	// The peek card draws the text as the row does.
	const peekOptions = $derived<PeekOptions>({
		text,
		touch: false,
		render: (el: HTMLElement) => renderInline(el, parseInline(text), sourcePath),
	});

	// ── Editing ──

	let draft = $state("");

	function beginEdit() {
		if (!onCommit || editing) return;
		editing = true;
	}

	// The editor starts from the current text whenever it opens, however it
	// was opened.
	function openEditor(node: HTMLInputElement | HTMLTextAreaElement) {
		draft = text;
		node.value = text;
		node.focus();
	}

	function commit() {
		if (!editing) return;
		editing = false;
		onCommit?.(singleLine(draft));
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			commit();
		} else if (event.key === "Escape") {
			event.preventDefault();
			editing = false;
		}
	}

	// ── Hold: drag or peek ──
	// The longpress action fires a bare CustomEvent, so the pointerdown that
	// started the press is kept and handed on when the press matures. A matured
	// hold waits to see what the pointer does next: moving past the slop hands
	// the drag to `onGrab`; lifting in place opens the full-text peek (the touch
	// equivalent of pointing at it). Releasing in place therefore never drops a
	// task back onto its own block.
	let held = $state(false);

	function hold(node: HTMLElement) {
		let pressEvent: PointerEvent | undefined;
		let cleanup: (() => void) | undefined;

		const arm = (event: PointerEvent) => {
			if (event.button === 0) pressEvent = event; // primary button only
		};
		const finish = () => {
			held = false;
			pressEvent = undefined;
			cleanup?.();
			cleanup = undefined;
		};
		const onLongpress = () => {
			const start = pressEvent;
			if (!start) return;
			held = true;
			const move = (e: PointerEvent) => {
				if (e.pointerId !== start.pointerId || !movedPastSlop(start, e)) return;
				finish();
				onGrab?.(e);
			};
			const up = (e: PointerEvent) => {
				if (e.pointerId !== start.pointerId) return;
				finish();
				peekIfTruncated(node, peekOptions);
			};
			const cancel = () => finish();
			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", up);
			window.addEventListener("pointercancel", cancel);
			cleanup = () => {
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", up);
				window.removeEventListener("pointercancel", cancel);
			};
		};

		node.addEventListener("pointerdown", arm);
		node.addEventListener("longpress", onLongpress);
		return {
			destroy() {
				node.removeEventListener("pointerdown", arm);
				node.removeEventListener("longpress", onLongpress);
				finish();
			},
		};
	}
</script>

{#if editing && wrapped}
	<!-- Wrapped text edits in a growing textarea so it wraps exactly as the
	     text did; Enter still commits, so it stays one line of markdown. -->
	<textarea
		class="kairos-item-input kairos-inline-input"
		rows="1"
		bind:value={draft}
		onkeydown={onKeydown}
		onblur={commit}
		use:openEditor
		use:autogrow
	></textarea>
{:else if editing}
	<input
		class="kairos-item-input kairos-inline-input"
		type="text"
		bind:value={draft}
		onkeydown={onKeydown}
		onblur={commit}
		use:openEditor
	/>
{:else}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<span
		class="kairos-item-text kairos-inline"
		class:wrapped
		class:struck={mark === "struck"}
		class:half={mark === "half"}
		class:editable={onCommit !== undefined}
		class:grabbable={onGrab !== undefined}
		class:held
		role={onCommit ? "textbox" : undefined}
		tabindex={onCommit ? 0 : undefined}
		style:--kairos-item-lines={wrapped ? lines : undefined}
		onclick={beginEdit}
		onkeydown={(e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				beginEdit();
			}
		}}
		use:longpress={400}
		use:hold
		use:peek={peekOptions}
	>
		<InlineText {text} {sourcePath} />
	</span>
{/if}

<style>
	.kairos-item-text,
	.kairos-item-input {
		flex: 1 1 auto;
		min-width: 0;
		font-size: var(--kairos-item-text-size, var(--kairos-text-body));
		line-height: 1.4;
		color: var(--text-normal);
	}

	.kairos-item-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		/* No text selection, so a hold doesn't paint a selection. */
		user-select: none;
	}

	/* Wrap, then clamp at `lines` with a trailing ellipsis. */
	.kairos-item-text.wrapped {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: var(--kairos-item-lines);
		line-clamp: var(--kairos-item-lines);
		white-space: normal;
		overflow-wrap: anywhere;
	}

	.kairos-item-text.editable {
		cursor: text;
	}

	/* Draggable: the browser mustn't take the hold for a scroll. */
	.kairos-item-text.grabbable {
		cursor: grab;
		touch-action: none;
	}

	/* A matured hold: tint the text so the press reads as registered before the
	   pointer decides between drag (move) and peek (lift). */
	.kairos-item-text.held {
		border-radius: var(--radius-s);
		background: var(--background-modifier-hover);
	}

	.kairos-item-text.struck {
		text-decoration: line-through;
		opacity: 0.5;
	}

	.kairos-item-text.half {
		opacity: 0.9;
	}

	/* The editor looks like the text it replaces: same box, no border, no
	   background, so editing feels like typing in place. */
	.kairos-item-input {
		font-family: inherit;
		margin: 0;
		padding: 0;
		outline: none;
	}
</style>
