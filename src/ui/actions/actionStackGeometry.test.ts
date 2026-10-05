import { describe, expect, it } from "vitest";
import {
	boxInside,
	clipsDescendants,
	formsFixedContainingBlock,
	intersectBoxes,
	placeActionStack,
	scrolls,
	stackCorner,
	stackSteps,
	tooltipSide,
	type StyleLike,
} from "./actionStackGeometry";

// A row at top 200, right edge 700; a 3-button stack 24 wide × 70 tall.
const row = { top: 200, right: 700 };
const W = 24;
const H = 70;
const roomy = { top: 0, bottom: 1000 };

describe("placeActionStack", () => {
	it("rises above the row, its corner cell on the row's top-right corner", () => {
		const p = placeActionStack(row, W, H, roomy);
		expect(p.direction).toBe("up");
		expect(p.left).toBe(700 - W);
		// Bottom of the stack = bottom of the corner cell = row.top + W.
		expect(p.top + H).toBe(row.top + W);
	});

	it("rises when it just fits under the bounds' top", () => {
		const p = placeActionStack(row, W, H, { top: row.top + W - H, bottom: 1000 });
		expect(p.direction).toBe("up");
	});

	it("hangs down from the corner when there is no room above", () => {
		const p = placeActionStack(row, W, H, { top: 180, bottom: 1000 });
		expect(p).toEqual({ left: 700 - W, top: row.top, direction: "down" });
	});

	it("picks the roomier side when neither fits", () => {
		// 30px above the corner cell's bottom, 40 below the row's top.
		expect(placeActionStack(row, W, H, { top: 194, bottom: 240 }).direction).toBe("down");
		expect(placeActionStack(row, W, H, { top: 150, bottom: 240 }).direction).toBe("up");
	});

	it("a one-button stack is just the corner cell and always fits up", () => {
		const p = placeActionStack(row, W, W, { top: row.top, bottom: row.top + W });
		expect(p).toEqual({ left: 700 - W, top: row.top, direction: "up" });
	});
});

describe("box helpers", () => {
	const a = { top: 0, left: 0, bottom: 100, right: 100 };
	it("intersects", () => {
		expect(intersectBoxes(a, { top: 50, left: -10, bottom: 200, right: 60 })).toEqual({
			top: 50,
			left: 0,
			bottom: 100,
			right: 60,
		});
	});
	it("checks containment with slack", () => {
		expect(boxInside({ top: 10, left: 10, bottom: 90, right: 90 }, a)).toBe(true);
		expect(boxInside({ top: -0.3, left: 0, bottom: 100, right: 100 }, a)).toBe(true);
		expect(boxInside({ top: -5, left: 0, bottom: 50, right: 50 }, a)).toBe(false);
	});
});

function style(over: Partial<StyleLike> = {}): StyleLike {
	return {
		transform: "none",
		filter: "none",
		perspective: "none",
		contain: "none",
		willChange: "auto",
		containerType: "normal",
		overflowX: "visible",
		overflowY: "visible",
		backdropFilter: "none",
		...over,
	};
}

describe("formsFixedContainingBlock", () => {
	it("is false for a plain element", () => {
		expect(formsFixedContainingBlock(style())).toBe(false);
		expect(formsFixedContainingBlock(style({ overflowX: "hidden", overflowY: "hidden" }))).toBe(false);
	});
	it.each([
		["transform", { transform: "matrix(1, 0, 0, 1, 0, 0)" }],
		["filter (a hovered timeline block)", { filter: "brightness(1.08)" }],
		["perspective", { perspective: "100px" }],
		["backdrop-filter", { backdropFilter: "blur(2px)" }],
		["contain: strict (Obsidian's .workspace-leaf)", { contain: "strict" }],
		["contain: layout", { contain: "layout style" }],
		["contain: paint", { contain: "paint" }],
		["size container", { containerType: "inline-size" }],
		["will-change: transform", { willChange: "transform, width" }],
	] as const)("is true for %s", (_name, over) => {
		expect(formsFixedContainingBlock(style(over))).toBe(true);
	});
	it("ignores will-change on unrelated properties", () => {
		expect(formsFixedContainingBlock(style({ willChange: "opacity" }))).toBe(false);
	});
});

describe("clipsDescendants / scrolls", () => {
	it("clips on any non-visible overflow or paint containment", () => {
		expect(clipsDescendants(style())).toBe(false);
		expect(clipsDescendants(style({ overflowX: "hidden", overflowY: "hidden" }))).toBe(true);
		expect(clipsDescendants(style({ overflowY: "auto" }))).toBe(true);
		expect(clipsDescendants(style({ contain: "strict" }))).toBe(true);
		expect(clipsDescendants(style({ contain: "layout" }))).toBe(false);
	});
	it("scrolls only on auto/scroll, not hidden/clip", () => {
		expect(scrolls(style({ overflowY: "auto" }))).toBe(true);
		expect(scrolls(style({ overflowX: "scroll" }))).toBe(true);
		expect(scrolls(style({ overflowX: "hidden", overflowY: "hidden" }))).toBe(false);
		expect(scrolls(style({ overflowX: "clip", overflowY: "clip" }))).toBe(false);
	});
});

describe("stackCorner", () => {
	const r = { top: 100, right: 500, bottom: 130 };
	it("puts the corner cell where the bar's right end sat (top-right)", () => {
		expect(stackCorner(r, { top: 0, right: 0 }, 24)).toEqual({ top: 100, right: 500 });
		// A timeline block's bar sits 4px in from its corner.
		expect(stackCorner(r, { top: 4, right: 4 }, 20)).toEqual({ top: 104, right: 496 });
	});
	it("centres the cell on the row for a bar centred on the right edge", () => {
		// 30px row, 26px cell: 2px above and below, whatever the measured inset.
		expect(stackCorner(r, { top: 7, right: 8 }, 26, "right")).toEqual({ top: 102, right: 492 });
		// A taller row (a meta line appeared) keeps it centred.
		expect(stackCorner({ ...r, bottom: 150 }, { top: 7, right: 8 }, 26, "right").top).toBe(112);
	});
});

describe("stackSteps", () => {
	it("counts outward from the lowest order, DOM order among equals", () => {
		// Task row: association, nest, delete (order -1) → delete, association, nest.
		expect(stackSteps([0, 0, -1])).toEqual([1, 2, 0]);
		// No delete: DOM order.
		expect(stackSteps([0, 0])).toEqual([0, 1]);
		expect(stackSteps([])).toEqual([]);
	});
});

describe("tooltipSide", () => {
	it("opens left unless the stack is too near the window's left edge", () => {
		expect(tooltipSide(600)).toBe("left");
		expect(tooltipSide(180)).toBe("left");
		expect(tooltipSide(120)).toBe("right");
		expect(tooltipSide(300, 200)).toBe("right");
	});
});
