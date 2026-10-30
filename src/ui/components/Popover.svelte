<script lang="ts">
	// The panel that opens over a view: a header badge's list, a picker, a
	// hover card, the calendar. It draws the panel (Obsidian's menu edge, the
	// Kairos popover corner, a background) and stacks its children in a column.
	// Use it for every popover instead of styling a <div> by hand (DESIGN.md).
	//
	// It only draws and places the panel. When it opens, where it goes and how
	// it closes stay with the component that owns it, which passes the panel's
	// coordinates and size in `style` and its role, label and handlers as
	// attributes. The look is global CSS (`.kairos-popover` in styles.css),
	// since most popovers are portaled out of their component.

	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	interface Props extends HTMLAttributes<HTMLDivElement> {
		/**
		 * "portal" (the default) moves it to the body and fixes it there, since a
		 * view's leaf is a transformed, clipping ancestor; place it with `top`
		 * and `left` in `style`. "anchored" positions it absolutely inside its
		 * positioned parent. "inline" leaves it in the flow, for a panel
		 * that a wrapper already places.
		 */
		placement?: "portal" | "anchored" | "inline";
		/** "secondary" for Kairos's own lists and cards (badge lists, hover cards). */
		surface?: "primary" | "secondary";
		/** Obsidian's spacing: none, 4px, 8px or 12px. */
		padding?: "none" | "s" | "m" | "l";
		/** Space between the children: none, 2px or 8px. */
		gap?: "none" | "s" | "m";
		/** "hidden" clips rows to the corners; "scroll" scrolls a long list. */
		overflow?: "visible" | "hidden" | "scroll";
		/** "menu" stacks it over modals, for pickers. */
		layer?: "popover" | "menu";
		/** The panel element, for outside-press checks and measuring. */
		el?: HTMLDivElement;
		children: Snippet;
	}

	let {
		placement = "portal",
		surface = "primary",
		padding = "none",
		gap = "none",
		overflow = "visible",
		layer = "popover",
		el = $bindable(),
		class: className,
		children,
		...attributes
	}: Props = $props();

	function portal(node: HTMLElement, on: boolean) {
		if (on) node.ownerDocument.body.appendChild(node);
		return {
			destroy() {
				if (on) node.remove();
			},
		};
	}
</script>

<div
	{...attributes}
	class={[
		"kairos-popover",
		`is-${placement}`,
		surface === "secondary" && "is-secondary",
		padding !== "none" && `is-pad-${padding}`,
		gap !== "none" && `is-gap-${gap}`,
		overflow === "hidden" && "is-clipped",
		overflow === "scroll" && "is-scrolling",
		layer === "menu" && "is-layer-menu",
		className,
	]}
	bind:this={el}
	use:portal={placement === "portal"}
>
	{@render children()}
</div>
