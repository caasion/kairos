import { describe, expect, it } from "vitest";
import { containsWithStacks, setStackOwner, stackOwnerOf } from "./stackOwner";

// Just enough of a DOM tree for containment: parent links and `contains`.
interface FakeNode {
	parentNode: FakeNode | null;
	contains(other: unknown): boolean;
}

function node(parent: FakeNode | null = null): FakeNode {
	const n: FakeNode = {
		parentNode: parent,
		contains(other) {
			for (let o = other as FakeNode | null; o; o = o.parentNode) if (o === n) return true;
			return false;
		},
	};
	return n;
}
const asNode = (n: FakeNode) => n as unknown as Node;

// body > bar > button > icon (portaled), and block > row (its owner).
function tree() {
	const body = node();
	const bar = node(body);
	const button = node(bar);
	const icon = node(button);
	const block = node(body);
	const row = node(block);
	const other = node(body);
	return { body, bar, button, icon, block, row, other };
}

describe("stackOwner", () => {
	it("finds the owning row from anywhere inside a portaled bar", () => {
		const t = tree();
		setStackOwner(asNode(t.bar), asNode(t.row));
		expect(stackOwnerOf(asNode(t.icon))).toBe(t.row);
		expect(stackOwnerOf(asNode(t.bar))).toBe(t.row);
		expect(stackOwnerOf(asNode(t.other))).toBeNull();
		expect(stackOwnerOf(null)).toBeNull();
	});

	it("forgets the owner once the bar is restored", () => {
		const t = tree();
		setStackOwner(asNode(t.bar), asNode(t.row));
		setStackOwner(asNode(t.bar), null);
		expect(stackOwnerOf(asNode(t.button))).toBeNull();
		expect(containsWithStacks(asNode(t.block), asNode(t.button))).toBe(false);
	});

	it("counts a portaled stack as inside whatever contains its row", () => {
		const t = tree();
		setStackOwner(asNode(t.bar), asNode(t.row));
		expect(containsWithStacks(asNode(t.block), asNode(t.icon))).toBe(true);
		expect(containsWithStacks(asNode(t.row), asNode(t.button))).toBe(true);
		// Not inside an unrelated element, nor is the rest of the body.
		expect(containsWithStacks(asNode(t.other), asNode(t.icon))).toBe(false);
		expect(containsWithStacks(asNode(t.block), asNode(t.other))).toBe(false);
		expect(containsWithStacks(asNode(t.block), null)).toBe(false);
	});

	it("still answers plain containment", () => {
		const t = tree();
		expect(containsWithStacks(asNode(t.block), asNode(t.row))).toBe(true);
		expect(containsWithStacks(asNode(t.block), asNode(t.block))).toBe(true);
	});
});
