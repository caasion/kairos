import { describe, expect, it } from "vitest";
import { singleLine } from "./autogrow";

describe("singleLine", () => {
	it("leaves single-line text alone", () => {
		expect(singleLine("Write the spec")).toBe("Write the spec");
	});

	it("folds a pasted newline, and the spaces around it, into one space", () => {
		expect(singleLine("Write the\nspec")).toBe("Write the spec");
		expect(singleLine("Write the  \r\n  spec")).toBe("Write the spec");
	});

	it("folds runs of blank lines into one space", () => {
		expect(singleLine("a\n\n\nb")).toBe("a b");
	});
});
