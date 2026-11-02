import { describe, expect, it } from "vitest";
import { ACTION_BAR_CLASS, ACTION_EAR_CLASS, ACTIONS_AWAKE_CLASS, actionZone } from "./actionZone";

// A minimal stand-in for the row and its bar: just the DOM surface the action
// touches, so it runs without a browser environment.
interface FakeHost {
	classList: { remove(c: string): void; toggle(c: string, force?: boolean): boolean };
	addEventListener(type: string, fn: (e: PointerEvent) => void): void;
	removeEventListener(type: string, fn: (e: PointerEvent) => void): void;
	getBoundingClientRect(): { top: number; right: number; width: number; height: number };
	querySelector(selector: string): unknown;
	ownerDocument: { activeElement: null; defaultView: unknown; createElement(tag: string): FakeEar };
	appendChild(child: FakeEar): void;
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
}

// The dog-ear the action appends to the row.
interface FakeEar {
	className: string;
	classList: { add(c: string): void; remove(c: string): void; toggle(c: string, force?: boolean): boolean; contains(c: string): boolean };
	style: { setProperty(name: string, value: string): void; getPropertyValue(name: string): string };
	setAttribute(name: string, value: string): void;
	remove(): void;
}

function makeEar(onRemove: () => void): FakeEar {
	const classes = new Set<string>();
	const props = new Map<string, string>();
	return {
		set className(v: string) {
			classes.clear();
			for (const c of v.split(" ")) if (c) classes.add(c);
		},
		get className() {
			return [...classes].join(" ");
		},
		classList: {
			add: (c) => void classes.add(c),
			remove: (c) => void classes.delete(c),
			toggle: (c, force) => {
				const on = force ?? !classes.has(c);
				if (on) classes.add(c);
				else classes.delete(c);
				return on;
			},
			contains: (c) => classes.has(c),
		},
		style: {
			setProperty: (n, v) => void props.set(n, v),
			getPropertyValue: (n) => props.get(n) ?? "",
		},
		setAttribute: () => {},
		remove: onRemove,
	};
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
	// The row's window: a manual clock (advance it with `tick`), tracked listeners.
	const winListeners = new Set<string>();
	let now = 0;
	let nextId = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const tick = (ms: number) => {
		now += ms;
		for (const [id, t] of [...timers]) {
			if (t.at <= now) {
				timers.delete(id);
				t.fn();
			}
		}
	};
	const win = {
		setTimeout: (fn: () => void, ms: number) => {
			timers.set(nextId, { at: now + ms, fn });
			return nextId++;
		},
		clearTimeout: (id: number | undefined) => void (id !== undefined && timers.delete(id)),
		addEventListener: (type: string) => void winListeners.add(type),
		removeEventListener: (type: string) => void winListeners.delete(type),
	};
	const children: FakeEar[] = [];
	const fake: FakeHost = {
		ownerDocument: {
			activeElement: null,
			defaultView: win,
			createElement: () => {
				const ear: FakeEar = makeEar(() => void children.splice(children.indexOf(ear), 1));
				return ear;
			},
		},
		appendChild: (child) => void children.push(child),
		setAttribute: () => {},
		removeAttribute: () => {},
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
	const ear = () => children.find((c) => c.classList.contains(ACTION_EAR_CLASS));
	return { host, bar, barChild, listeners, winListeners, tick, selectors, fire, move, awake, ear };
}

describe("actionZone", () => {
	it("adds a dog-ear that shows on the row and grows toward the corner", () => {
		const row = makeRow();
		actionZone(row.host);
		const ear = row.ear();
		expect(ear).toBeDefined();
		expect(ear?.classList.contains("is-shown")).toBe(false);
		row.move(400, 205);
		expect(ear?.classList.contains("is-shown")).toBe(true);
		const far = Number(ear?.style.getPropertyValue("--kairos-action-ear-near"));
		row.move(650, 205);
		const near = Number(ear?.style.getPropertyValue("--kairos-action-ear-near"));
		expect(near).toBeGreaterThan(far);
		row.fire("pointerleave");
		expect(ear?.classList.contains("is-shown")).toBe(false);
	});

	it("shows no dog-ear on a row without a bar", () => {
		const row = makeRow(false);
		actionZone(row.host);
		row.move(690, 202);
		expect(row.ear()?.classList.contains("is-shown")).toBe(false);
	});

	it("gives a right-anchored row the edge notch, and removes the ear on destroy", () => {
		const row = makeRow();
		const zone = actionZone(row.host, { anchor: "right" });
		expect(row.ear()?.classList.contains("kairos-action-ear-right")).toBe(true);
		zone.destroy();
		expect(row.ear()).toBeUndefined();
	});

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

	it("stays asleep over a nested row that has its own zone", () => {
		const row = makeRow();
		const nested = {};
		(row.host as unknown as { contains: (n: unknown) => boolean }).contains = (n) => n === nested;
		actionZone(row.host);
		const target = { closest: () => nested } as unknown as EventTarget;
		row.move(690, 202, { target });
		expect(row.awake()).toBe(false);
		// Its own row (closest is the host itself) still wakes.
		const own = { closest: () => row.host } as unknown as EventTarget;
		row.move(690, 202, { target: own });
		expect(row.awake()).toBe(true);
	});

	describe("stack layout", () => {
		// No bar rendered, so nothing needs a real DOM to lay out.
		it("sleeps only after a short grace once the pointer leaves", () => {
			const row = makeRow(false);
			actionZone(row.host, { layout: "stack" });
			row.move(690, 202);
			row.fire("pointerleave");
			expect(row.awake()).toBe(true);
			row.tick(200);
			expect(row.awake()).toBe(false);
			// Scroll/resize are only listened to while the stack is up.
			expect(row.winListeners.size).toBe(0);
		});

		it("coming back into the zone within the grace keeps it awake", () => {
			const row = makeRow(false);
			actionZone(row.host, { layout: "stack" });
			row.move(690, 202);
			row.fire("pointerleave");
			row.move(690, 202);
			row.tick(200);
			expect(row.awake()).toBe(true);
		});

		it("destroy cancels a pending sleep and removes its listeners", () => {
			const row = makeRow(false);
			const action = actionZone(row.host, { layout: "stack" });
			row.move(690, 202);
			row.fire("pointerleave");
			expect(row.winListeners).toEqual(new Set(["scroll", "resize"]));
			action.destroy();
			row.tick(200);
			expect(row.awake()).toBe(false);
			expect(row.listeners.size).toBe(0);
			expect(row.winListeners.size).toBe(0);
		});
	});
});
