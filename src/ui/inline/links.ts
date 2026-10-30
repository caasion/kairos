// How links, tags and URLs in item text behave: like Obsidian's own.
//
//   • A note link opens the note; Ctrl/Cmd-click (or a middle click) opens it
//     in a new tab. An unresolved one gets Obsidian's unresolved style and a
//     click creates the note, as in a note.
//   • Pointing at a note link triggers Obsidian's page preview (the
//     "hover-link" event, under the "Kairos" source in Page preview's
//     settings).
//   • A web link opens in the browser (a native <a target="_blank">).
//   • A #tag opens Obsidian's search for it.
//
// A press or click on any of them stops there, so it never starts editing the
// row or a drag. Both renderers use these: InlineText.svelte in the views,
// and renderInline below for text drawn from TypeScript (the peek card).
//
// The views reach the app through this module rather than a prop on every
// row: the plugin sets it once on load (setLinkApp).

import { Keymap, getLinkpath, type App, type HoverParent } from "obsidian";
import { writable } from "svelte/store";
import type { Inline } from "../../inline";

export const HOVER_SOURCE = "kairos";

let app: App | undefined;
const hoverParent: HoverParent = { hoverPopover: null };

// Bumped when notes appear, disappear or move, so link styles re-resolve.
const version = writable(0);
export const linkVersion = { subscribe: version.subscribe };

export function setLinkApp(next: App | undefined): void {
	app = next;
}

export function notesChanged(): void {
	version.update((v) => v + 1);
}

/** Whether a note link points at an existing file. */
export function isResolved(target: string, sourcePath: string): boolean {
	if (!app) return true;
	const path = getLinkpath(target);
	// A link to a heading in the same note ("[[#Plan]]") is always there.
	if (!path) return true;
	return app.metadataCache.getFirstLinkpathDest(path, sourcePath) !== null;
}

// ─── events ────────────────────────────────────────────────────

/** A click (or middle click) on a link, tag or URL. */
export function onLinkClick(event: MouseEvent, sourcePath: string): void {
	const a = anchorOf(event);
	if (!a) return;
	event.stopPropagation();
	if (a.classList.contains("external-link")) return; // the browser opens it
	event.preventDefault();
	if (!app) return;
	if (a.classList.contains("tag")) {
		openTagSearch(app, a.dataset.tag ?? "");
		return;
	}
	const target = a.dataset.href;
	if (target) void app.workspace.openLinkText(target, sourcePath, Keymap.isModEvent(event));
}

/** Pointing at a note link: Obsidian's page preview. */
export function onLinkHover(event: MouseEvent, sourcePath: string): void {
	const a = anchorOf(event);
	if (!app || !a?.classList.contains("internal-link")) return;
	app.workspace.trigger("hover-link", {
		event,
		source: HOVER_SOURCE,
		hoverParent,
		targetEl: a,
		linktext: a.dataset.href ?? "",
		sourcePath,
	});
}

/**
 * A press or Enter on a link stops at the link, so the row doesn't start a
 * hold-to-drag or open its editor.
 */
export function onLinkPress(event: PointerEvent | KeyboardEvent): void {
	if (event instanceof KeyboardEvent && event.key !== "Enter") return;
	if (anchorOf(event)) event.stopPropagation();
}

function anchorOf(event: Event): HTMLAnchorElement | null {
	const target = event.target;
	if (!(target instanceof Element)) return null;
	return target.closest("a.internal-link, a.external-link, a.tag");
}

// Obsidian's search has no public API; this is what clicking a tag in a note
// does. Without the core Search plugin, nothing happens.
interface SearchPlugin {
	instance?: { openGlobalSearch?: (query: string) => void };
}
interface InternalPlugins {
	internalPlugins?: { getPluginById?: (id: string) => SearchPlugin | null };
}

function openTagSearch(app: App, tag: string): void {
	const search = (app as App & InternalPlugins).internalPlugins?.getPluginById?.("global-search");
	search?.instance?.openGlobalSearch?.(`tag:#${tag}`);
}

// ─── drawing from TypeScript ───────────────────────────────────

/**
 * Draw the pieces into `parent` with the same elements InlineText.svelte
 * makes, and wire their links. For text drawn outside Svelte (the peek card).
 */
export function renderInline(
	parent: HTMLElement,
	pieces: readonly Inline[],
	sourcePath: string,
): void {
	draw(parent, pieces, sourcePath);
	parent.addEventListener("click", (e) => onLinkClick(e, sourcePath));
	parent.addEventListener("auxclick", (e) => onLinkClick(e, sourcePath));
	parent.addEventListener("pointerover", (e) => onLinkHover(e, sourcePath));
}

function draw(parent: HTMLElement, pieces: readonly Inline[], sourcePath: string): void {
	for (const p of pieces) {
		switch (p.kind) {
			case "text":
				parent.appendText(p.text);
				break;
			case "code":
				parent.createEl("code", { text: p.text });
				break;
			case "tag":
				parent.createEl("a", {
					cls: "tag",
					text: `#${p.tag}`,
					href: `#${p.tag}`,
					attr: { "data-tag": p.tag },
				});
				break;
			case "internal": {
				const a = parent.createEl("a", {
					cls: "internal-link",
					href: p.target,
					attr: { "data-href": p.target },
				});
				if (!isResolved(p.target, sourcePath)) a.addClass("is-unresolved");
				draw(a, p.children, sourcePath);
				break;
			}
			case "external":
				draw(
					parent.createEl("a", {
						cls: "external-link",
						href: p.url,
						attr: { target: "_blank", rel: "noopener nofollow" },
					}),
					p.children,
					sourcePath,
				);
				break;
			default:
				draw(parent.createEl(p.kind), p.children, sourcePath);
		}
	}
}
