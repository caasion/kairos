import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grabOnHold, HOLD_EXEMPT_SELECTOR, pressOnControl } from "./grabOnHold";

type Listener = (e: unknown) => void;

// Just enough of an event target: listeners by type, and a way to fire them.
function target() {
	const listeners = new Map<string, Set<Listener>>();
	return {
		addEventListener(type: string, fn: Listener) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(fn);
		},
		removeEventListener(type: string, fn: Listener) {
			listeners.get(type)?.delete(fn);
		},
		fire(type: string, e: unknown) {
			for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
		},
		count(type: string) {
			return listeners.get(type)?.size ?? 0;
		},
	};
}

// The header, its window, and two things to press on: the header's own label
// and a control (the action bar's button or the rename input) inside it.
function setup() {
	const win = target();
	const node = {
		...target(),
		ownerDocument: { defaultView: win },
		classList: { add: vi.fn(), remove: vi.fn() },
		dispatchEvent: vi.fn(),
	};
	const label = { closest: () => null };
	const control = { closest: (sel: string) => (sel === HOLD_EXEMPT_SELECTOR ? {} : null) };
	const onGrab = vi.fn();
	const action = grabOnHold(node as unknown as HTMLElement, onGrab);
	const press = (on: unknown, x = 0, y = 0) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, target: on });
	return { win, node, label, control, onGrab, action, press };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("grabOnHold", () => {
	it("lifts the block after a held press on the header moves past the slop", () => {
		const s = setup();
		s.node.fire("pointerdown", s.press(s.label));
		vi.advanceTimersByTime(400);
		s.win.fire("pointermove", s.press(s.label, 20, 0));
		expect(s.onGrab).toHaveBeenCalledTimes(1);
		expect(s.win.count("pointermove")).toBe(0);
	});

	it("never arms from a press on a control in the header", () => {
		const s = setup();
		// Drag-selecting in the rename input, or holding a stack button.
		s.node.fire("pointerdown", s.press(s.control));
		vi.advanceTimersByTime(1000);
		s.win.fire("pointermove", s.press(s.control, 40, 0));
		expect(s.onGrab).not.toHaveBeenCalled();
		expect(s.win.count("pointermove")).toBe(0);
		expect(s.node.classList.add).not.toHaveBeenCalled();
	});

	it("doesn't swallow the click after a hold on a control", () => {
		const s = setup();
		s.node.fire("pointerdown", s.press(s.control));
		vi.advanceTimersByTime(1000);
		const click = { stopImmediatePropagation: vi.fn(), preventDefault: vi.fn() };
		s.node.fire("click", click);
		expect(click.stopImmediatePropagation).not.toHaveBeenCalled();
	});

	it("does nothing when released in place", () => {
		const s = setup();
		s.node.fire("pointerdown", s.press(s.label));
		vi.advanceTimersByTime(400);
		s.win.fire("pointerup", s.press(s.label));
		s.win.fire("pointermove", s.press(s.label, 40, 0));
		expect(s.onGrab).not.toHaveBeenCalled();
	});

	it("removes its window listeners on destroy", () => {
		const s = setup();
		s.node.fire("pointerdown", s.press(s.label));
		vi.advanceTimersByTime(400);
		expect(s.win.count("pointermove")).toBe(1);
		s.action.destroy();
		expect(s.win.count("pointermove")).toBe(0);
		expect(s.node.count("pointerdown")).toBe(0);
	});
});

describe("pressOnControl", () => {
	it("is true only inside a control", () => {
		expect(pressOnControl({ closest: () => ({}) } as unknown as EventTarget)).toBe(true);
		expect(pressOnControl({ closest: () => null } as unknown as EventTarget)).toBe(false);
		expect(pressOnControl({} as EventTarget)).toBe(false);
		expect(pressOnControl(null)).toBe(false);
	});
});
