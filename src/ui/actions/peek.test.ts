import { describe, expect, it } from "vitest";
import { isTruncated, movedPastSlop, PEEK_SLOP } from "./peek";

describe("isTruncated", () => {
	it("is false when the content fits", () => {
		expect(isTruncated({ scrollWidth: 100, clientWidth: 100, scrollHeight: 17, clientHeight: 17 })).toBe(false);
	});

	it("is true when the content overflows horizontally (ellipsis)", () => {
		expect(isTruncated({ scrollWidth: 240, clientWidth: 100, scrollHeight: 17, clientHeight: 17 })).toBe(true);
	});

	it("is true when the content overflows vertically (line clamp)", () => {
		expect(isTruncated({ scrollWidth: 100, clientWidth: 100, scrollHeight: 51, clientHeight: 34 })).toBe(true);
	});

	it("tolerates a 1px subpixel rounding difference", () => {
		expect(isTruncated({ scrollWidth: 101, clientWidth: 100, scrollHeight: 18, clientHeight: 17 })).toBe(false);
	});
});

describe("movedPastSlop", () => {
	const from = { clientX: 50, clientY: 50 };

	it("treats a jitter inside the slop as holding still", () => {
		expect(movedPastSlop(from, { clientX: 53, clientY: 54 })).toBe(false);
		expect(movedPastSlop(from, { clientX: 50 + PEEK_SLOP, clientY: 50 })).toBe(false);
	});

	it("treats travel past the slop as a drag, in any direction", () => {
		expect(movedPastSlop(from, { clientX: 50 + PEEK_SLOP + 1, clientY: 50 })).toBe(true);
		expect(movedPastSlop(from, { clientX: 50, clientY: 50 - PEEK_SLOP - 1 })).toBe(true);
		expect(movedPastSlop(from, { clientX: 57, clientY: 57 })).toBe(true);
	});

	it("honours a custom slop", () => {
		expect(movedPastSlop(from, { clientX: 70, clientY: 50 }, 30)).toBe(false);
	});
});
