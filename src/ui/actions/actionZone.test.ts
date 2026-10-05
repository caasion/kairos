import { describe, expect, it } from "vitest";
import { ACTION_BAR_CLASS, ACTIONS_AWAKE_CLASS, actionZone } from "./actionZone";

// A minimal stand-in for the row and its bar: just the DOM surface the action
// touches, so it runs without a browser environment.
interface FakeHost {
	classList: { remove(c: string): void; toggle(c: string, force?: boolean): boolean };
	addEventListener(type: string, fn: (e: PointerEvent) => void): void;
	removeEventListener(type: string, fn: (e: PointerEvent) => void): void;
	getBoundingClientRect(): { top: number; right: number; width: number; height: number };
	querySelector(selector: string): unknown;
}

function makeRow(withBar = true) {
	const classes = new Set<string>();
	const listeners = new Map<string, (e: PointerEvent) => void>();
	const barChild = {};
	const bar = {
		offsetWidth: 90,
		contains: (other: unknown) => other === bar || other === barChild,
	};
	const selectors: string[] = [];
	const fake: FakeHost = {
		classList: {
			remove: (c) => void classes.delete(c),
			toggle: (c, force) => {
				const on = force ?? !classes.has(c);
				if (on) classes.add(c);
				else classes.delete(c);
				return on;
			},
		},
		addEventListener: (type, fn) => void listeners.set(type, fn),
		removeEventListener: (type, fn) => {
			if (listeners.get(type) === fn) listeners.delete(type);
		},
		// A 600×40 row at (100, 200)–(700, 240).
		getBoundingClientRect: () => ({ top: 200, right: 700, width: 600, height: 40 }),
		querySelector: (selector) => {
			selectors.push(selector);
			return withBar ? bar : null;
		},
	};
	const host = fake as unknown as HTMLElement;
	const fire = (type: string, init: Partial<PointerEvent> = {}) =>
		listeners.get(type)?.({ pointerType: "mouse", target: null, ...init } as PointerEvent);
	const move = (clientX: number, clientY: number, init: Partial<PointerEvent> = {}) =>
		fire("pointermove", { clientX, clientY, ...init });
	const awake = () => classes.has(ACTIONS_AWAKE_CLASS);
	return { host, bar, barChild, listeners, selectors, fire, move, awake };
}

describe("actionZone", () => {
	it("wakes the row only inside the top-right triangle", () => {
		const row = makeRow();
		actionZone(row.host);
		row.move(400, 205);
		expect(row.awake()).toBe(false);
		row.move(690, 202);
		expect(row.awake()).toBe(true);
		row.move(400, 205);
		expect(row.awake()).toBe(false);
	});

	it("looks the bar up as a direct child of the row", () => {
		const row = makeRow();
		actionZone(row.host);
		row.move(690, 202);
		expect(row.selectors).toContain(`:scope > .${ACTION_BAR_CLASS}`);
	});

	it("keeps the bar awake while the pointer is on the bar, even outside the triangle", () => {
		const row = makeRow();
		actionZone(row.host);
		row.move(690, 202);
		// Lower-left of the bar: outside the triangle, but on the bar.
		row.move(615, 230, { target: row.barChild as EventTarget });
		expect(row.awake()).toBe(true);
	});

	it("does not wake from the bar while asleep (it's pointer-inert then)", () => {
		const row = makeRow();
		actionZone(row.host);
		row.move(615, 230, { target: row.barChild as EventTarget });
		expect(row.awake()).toBe(false);
	});

	it("sleeps when the pointer leaves the row", () => {
		const row = makeRow();
		actionZone(row.host);
		row.move(690, 202);
		row.fire("pointerleave");
		expect(row.awake()).toBe(false);
	});

	it("ignores touch and pen: they keep the CSS hover fallback", () => {
		const row = makeRow();
		actionZone(row.host);
		row.move(690, 202, { pointerType: "touch" });
		row.move(690, 202, { pointerType: "pen" });
		expect(row.awake()).toBe(false);
	});

	it("honours the anchor option, and updates to it", () => {
		const row = makeRow();
		const action = actionZone(row.host, { anchor: "right" });
		// Top edge near the corner: in the top-right triangle, not the right one.
		row.move(650, 200);
		expect(row.awake()).toBe(false);
		row.move(600, 220);
		expect(row.awake()).toBe(true);
		action.update({ anchor: "top-right" });
		row.move(650, 200);
		expect(row.awake()).toBe(true);
	});

	it("still works with no bar rendered (zone falls back to the row fraction)", () => {
		const row = makeRow(false);
		actionZone(row.host);
		row.move(690, 202);
		expect(row.awake()).toBe(true);
	});

	it("removes its listeners and class on destroy", () => {
		const row = makeRow();
		const action = actionZone(row.host);
		row.move(690, 202);
		action.destroy();
		expect(row.awake()).toBe(false);
		expect(row.listeners.size).toBe(0);
	});
});
