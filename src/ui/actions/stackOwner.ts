// Which row a portaled action stack belongs to.
//
// While portaled (actionStack.ts) a row's stack sits at the end of the body,
// so it is no longer a DOM descendant of its row or of the row's ancestors.
// The row itself copes (actionZone keeps it awake while the pointer is on the
// stack), but an ancestor that tracks whether the pointer or a press is still
// "in" it would see the stack as somewhere else. A timeline block grown to
// show all its tasks is one: it would shrink as the pointer reached a task's
// stack, unmounting the task and its stack before the click landed. Such an
// ancestor asks here instead of `contains`.

const owners = new WeakMap<Node, Node>();

/** Record the row that owns a portaled stack's bar, or with `null` forget it. */
export function setStackOwner(bar: Node, row: Node | null) {
	if (row) owners.set(bar, row);
	else owners.delete(bar);
}

/** The row whose portaled stack `node` is in (or is), else null. */
export function stackOwnerOf(node: Node | null): Node | null {
	for (let n = node; n; n = n.parentNode) {
		const row = owners.get(n);
		if (row) return row;
	}
	return null;
}

/**
 * Whether `node` is `container` or inside it, counting a portaled stack as
 * part of its row (and so of whatever contains the row).
 */
export function containsWithStacks(container: Node, node: Node | null): boolean {
	if (!node) return false;
	if (container.contains(node)) return true;
	const row = stackOwnerOf(node);
	return row !== null && container.contains(row);
}
