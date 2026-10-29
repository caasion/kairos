// The timeline controls' number fields (hour range, hour height, Week span)
// apply on `change` — Enter, leaving the field, or the arrow keys — rather than
// on every keystroke. Clamping each keystroke made typing fight the field:
// "30" went 3 → clamped to 20 → "200" (#68).

/**
 * Apply a number field's value through `set`, which clamps it, saves it and
 * returns what's now in effect. The field then shows that value, so an
 * out-of-range or cleared entry snaps back instead of lingering.
 */
export function commitNumber(input: HTMLInputElement, set: (value: number) => number): void {
	input.value = String(set(input.valueAsNumber));
}
