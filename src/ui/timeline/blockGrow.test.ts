import { describe, expect, it } from "vitest";
import { ACTIONS_AWAKE_CLASS } from "../actions/actionZone";
import { setStackOwner } from "../actions/stackOwner";
import { BLOCK_OVERLAY_SELECTOR, blockInUse, focusInBlock, pressInBlock } from "./blockGrow";

// A stand-in for the grown block and its document: containment by identity,
// and the selector queries the helpers make answered from flags.
function setup() {
	const state = {
		active: null as unknown,
		blockAwake: false,
		rowAwake: false,
		hovered: false,
		overlayOpen: false,
	};
	const row = { parentNode: null as unknown };
	const doc = {
		get activeElement() {
			return state.active;
		},
		querySelector: (sel: string) => (sel === BLOCK_OVERLAY_SELECTOR && state.overlayOpen ? {} : null),
	};
	const block = {
		ownerDocument: doc,
		contains: (n: unknown) => n === block || n === row,
		matches: (sel: string) =>
			(sel === `.${ACTIONS_AWAKE_CLASS}` && state.blockAwake) || (sel === ":hover" && state.hovered),
		querySelector: (sel: string) => (sel === `.${ACTIONS_AWAKE_CLASS}` && state.rowAwake ? row : null),
	};
	row.parentNode = block;
	// A portaled stack of the row: a bar in the body with a button in it.
	const bar = { parentNode: null };
	const button = { parentNode: bar, closest: () => null };
	setStackOwner(bar as unknown as Node, row as unknown as Node);
	const el = block as unknown as Element;
	return { state, el, row, button };
}

describe("blockGrow", () => {
	it("is not in use once nothing in or from it is", () => {
		const { el } = setup();
		expect(blockInUse(el)).toBe(false);
	});

	it("is in use while a task's (possibly portaled) stack or its own is up", () => {
		const s = setup();
		s.state.rowAwake = true;
		expect(blockInUse(s.el)).toBe(true);
		s.state.rowAwake = false;
		s.state.blockAwake = true;
		expect(blockInUse(s.el)).toBe(true);
	});

	it("is in use while a menu or picker is open, or the pointer is over it", () => {
		const s = setup();
		s.state.overlayOpen = true;
		expect(blockInUse(s.el)).toBe(true);
		s.state.overlayOpen = false;
		s.state.hovered = true;
		expect(blockInUse(s.el)).toBe(true);
	});

	it("counts focus on a task's portaled stack as focus in the block", () => {
		const s = setup();
		expect(focusInBlock(s.el)).toBe(false);
		s.state.active = s.row;
		expect(focusInBlock(s.el)).toBe(true);
		s.state.active = s.button;
		expect(focusInBlock(s.el)).toBe(true);
	});

	it("doesn't count a press on a task's portaled stack as elsewhere", () => {
		const s = setup();
		expect(pressInBlock(s.el, s.button as unknown as EventTarget)).toBe(true);
		expect(pressInBlock(s.el, s.row as unknown as EventTarget)).toBe(true);
	});

	it("doesn't count a press in a menu or picker as elsewhere", () => {
		const s = setup();
		const menuItem = { parentNode: null, closest: (sel: string) => (sel === BLOCK_OVERLAY_SELECTOR ? {} : null) };
		expect(pressInBlock(s.el, menuItem as unknown as EventTarget)).toBe(true);
	});

	it("counts any other press as elsewhere", () => {
		const s = setup();
		const outside = { parentNode: null, closest: () => null };
		expect(pressInBlock(s.el, outside as unknown as EventTarget)).toBe(false);
		expect(pressInBlock(s.el, null)).toBe(false);
	});
});
