// A Svelte action that sizes a <textarea> to its content, so an inline editor
// for wrapped text grows line by line instead of scrolling inside a fixed box.
// Used where the static label wraps (grid tasks, backlog items): the editor
// then wraps the same way, keeping edit mode visually identical to read mode.

export function autogrow(node: HTMLTextAreaElement) {
	const fit = () => {
		// Reset first so the box can shrink when lines are deleted.
		node.setCssStyles({ height: "auto" });
		node.setCssStyles({ height: `${node.scrollHeight}px` });
	};
	fit();
	// The bound value may land after mount; refit once it has.
	const frame = window.requestAnimationFrame(fit);
	node.addEventListener("input", fit);
	return {
		destroy() {
			window.cancelAnimationFrame(frame);
			node.removeEventListener("input", fit);
		},
	};
}

/**
 * A task or backlog item is a single markdown line: fold any newlines (typed
 * via paste, since Enter commits) into spaces before saving.
 */
export function singleLine(text: string): string {
	return text.replace(/\s*[\r\n]+\s*/g, " ");
}
