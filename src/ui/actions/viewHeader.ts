// A Svelte action that moves a view's header bar (date navigator, settings)
// into Obsidian's tab header, in place of the tab's title:
//
//   <div class="grid-header" use:intoViewHeader={viewHeader}>…</div>
//
// `viewHeader` is the leaf's `.view-header` element. The bar stays a Svelte
// node, so its handlers, scoped styles and popovers work as before. When
// there's no header to move into (none passed, or a sidebar leaf, where
// Obsidian hides it), the bar stays at the top of the view.

const HOST_CLASS = "kairos-header-host";
const BAR_CLASS = "kairos-header-bar";

export function findViewHeader(containerEl: HTMLElement): HTMLElement | undefined {
	return containerEl.querySelector<HTMLElement>(":scope > .view-header") ?? undefined;
}

export function intoViewHeader(node: HTMLElement, viewHeader: HTMLElement | undefined) {
	const slot = viewHeader?.querySelector<HTMLElement>(".view-header-title-container");
	if (!viewHeader || !slot || viewHeader.closest(".mod-sidedock")) return;

	const home = node.parentElement;
	const next = node.nextSibling;
	viewHeader.addClass(HOST_CLASS);
	node.addClass(BAR_CLASS);
	slot.appendChild(node);

	return {
		destroy() {
			viewHeader.removeClass(HOST_CLASS);
			node.removeClass(BAR_CLASS);
			// Put the node back so Svelte can remove it from where it expects it.
			if (home?.isConnected) home.insertBefore(node, next);
			else node.remove();
		},
	};
}
