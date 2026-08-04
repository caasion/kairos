// Shared placement for popups that float at a screen-anchor rect (a portal'd
// element positioned `fixed`). Keeps the panel inside the viewport: clamps the
// left edge, and flips above the anchor when opening below would overflow the
// bottom. Mirrors the logic already used inline by AssociationPicker so every
// floating popup dodges the "opens off-screen" bug the same way.

export interface FloatRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface PlaceOptions {
	/** Gap between the anchor and the panel, and the min viewport margin. */
	margin?: number;
	/** Panel width; used to clamp the left edge. */
	width: number;
	/** Panel height; used to decide whether to flip above the anchor. */
	height: number;
}

/**
 * A `fixed`-positioning CSS string (`left/top`) placing a panel of the given
 * size just under `anchor`, flipped above it when it would overflow the bottom,
 * and clamped so it never leaves the viewport.
 */
export function placeUnderAnchor(anchor: FloatRect, opts: PlaceOptions): string {
	const margin = opts.margin ?? 6;

	const rawLeft = Math.min(anchor.left, window.innerWidth - opts.width - margin);
	const left = Math.max(margin, rawLeft);

	const below = anchor.bottom + margin;
	const flipUp =
		below + opts.height > window.innerHeight && anchor.top - opts.height - margin >= margin;
	const rawTop = flipUp ? anchor.top - opts.height - margin : below;
	const top = Math.max(margin, Math.min(rawTop, window.innerHeight - opts.height - margin));

	return `left: ${left}px; top: ${top}px;`;
}
