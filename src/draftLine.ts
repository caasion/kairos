// Throwaway source lines for objects that exist before their file does.
//
// A block, task, or backlog entry is identified everywhere by its `SourceRef`
// (path + line): the writer matches on it, and the views key their `{#each}`
// blocks by it. A freshly-created object has no file line yet — it only gets one
// when the note is rewritten and reparsed — so it carries a negative placeholder
// until then.
//
// Those placeholders MUST be unique. Two objects sharing a line make the writer
// patch the wrong one, and make a keyed `{#each}` collide, which stops Svelte
// reconciling that list at all (a frozen view). Per-component counters can't
// guarantee that: they restart at their own seed on every mount, and several
// components create into the same day (or the same backlog) at once. One
// module-level counter for the whole plugin does.
//
// The counter never resets. It only has to outlast the placeholders it hands
// out, and those live at most until the next reparse.

let next = -1;

/** A fresh, never-repeated negative line for an object that isn't on disk yet. */
export function nextDraftLine(): number {
	return next--;
}
