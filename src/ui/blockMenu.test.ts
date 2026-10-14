import { afterEach, describe, expect, it, vi } from "vitest";
import type { Menu } from "obsidian";
import { addBlockMenuItems, type BlockMenuActions } from "./blockMenu";
import { setRepeatHandler } from "../routines/repeat";
import type { Block, TaskStatus } from "../types";

// A stand-in for Obsidian's Menu that records each item's title and click.
interface Item {
	title: string;
	click: () => void;
}
function fakeMenu(): { menu: Menu; items: (Item | "---")[] } {
	const items: (Item | "---")[] = [];
	const menu = {
		addItem(build: (item: unknown) => unknown) {
			const entry: Item = { title: "", click: () => {} };
			const item = {
				setTitle(t: string) {
					entry.title = t;
					return item;
				},
				setIcon() {
					return item;
				},
				onClick(fn: () => void) {
					entry.click = fn;
					return item;
				},
			};
			build(item);
			items.push(entry);
			return menu;
		},
		addSeparator() {
			items.push("---");
			return menu;
		},
	};
	return { menu: menu as unknown as Menu, items };
}

function titles(items: (Item | "---")[]): string[] {
	return items.map((i) => (i === "---" ? "---" : i.title));
}
function click(items: (Item | "---")[], title: string) {
	const item = items.find((i): i is Item => i !== "---" && i.title === title);
	if (!item) throw new Error(`no "${title}" item`);
	item.click();
}

// Every handler, as a mock (each view passes some subset).
function actions() {
	return {
		onAddTask: vi.fn<() => void>(),
		onAddNote: vi.fn<() => void>(),
		onEditAssoc: vi.fn<() => void>(),
		onToggleCheckable: vi.fn<() => void>(),
		onSetStatus: vi.fn<(status: TaskStatus) => void>(),
		onDelete: vi.fn<() => void>(),
		onReveal: vi.fn<() => void>(),
	} satisfies BlockMenuActions;
}

const timed: Block = {
	source: { path: "mon.md", line: 3 },
	title: "Deep work",
	scheduled: true,
	time: { start: 540, end: 600 },
	tasks: [],
};

describe("addBlockMenuItems", () => {
	afterEach(() => setRepeatHandler(undefined));

	it("offers a plain timed block every block action, without status items", () => {
		const { menu, items } = fakeMenu();
		addBlockMenuItems(menu, timed, actions());
		expect(titles(items)).toEqual([
			"Add task",
			"Add note",
			"Add association",
			"Repeat…",
			"Open in day view",
			"---",
			"Convert to task",
			"---",
			"Delete block",
		]);
	});

	it("offers a checkable block's status items and 'Convert to block'", () => {
		const { menu, items } = fakeMenu();
		const block: Block = { ...timed, status: "x", assoc: { kind: "project", id: "Kairos" } };
		addBlockMenuItems(menu, block, actions());
		expect(titles(items)).toEqual([
			"Add task",
			"Add note",
			"Edit association",
			"Repeat…",
			"Open in day view",
			"---",
			"Convert to block",
			"Mark open",
			"Mark half-done",
			"Mark cancelled",
			"---",
			"Delete block",
		]);
	});

	it("leaves out the items a view has no handler for, and Repeat… for an untimed block", () => {
		const { menu, items } = fakeMenu();
		const { onAddTask: _a, onAddNote: _n, onReveal: _r, ...rest } = actions();
		const untimed: Block = { ...timed, title: "Errands", time: undefined };
		addBlockMenuItems(menu, untimed, rest);
		expect(titles(items)).toEqual([
			"Add association",
			"---",
			"Convert to task",
			"---",
			"Delete block",
		]);
	});

	it("routes each item to its handler", () => {
		const { menu, items } = fakeMenu();
		const a = actions();
		const repeat = vi.fn();
		setRepeatHandler(repeat);
		addBlockMenuItems(menu, { ...timed, status: " " }, a);
		click(items, "Add task");
		click(items, "Add note");
		click(items, "Add association");
		click(items, "Open in day view");
		click(items, "Convert to block");
		click(items, "Mark done");
		click(items, "Mark half-done");
		click(items, "Delete block");
		click(items, "Repeat…");
		expect(a.onAddTask).toHaveBeenCalledOnce();
		expect(a.onAddNote).toHaveBeenCalledOnce();
		expect(a.onEditAssoc).toHaveBeenCalledOnce();
		expect(a.onReveal).toHaveBeenCalledOnce();
		expect(a.onToggleCheckable).toHaveBeenCalledOnce();
		expect(a.onSetStatus.mock.calls).toEqual([["x"], ["/"]]);
		expect(a.onDelete).toHaveBeenCalledOnce();
		// Repeat… starts from the block's own line.
		expect(repeat).toHaveBeenCalledOnce();
		expect(repeat.mock.calls[0]![0]).toMatchObject({ source: timed.source, text: "Deep work" });
	});
});
