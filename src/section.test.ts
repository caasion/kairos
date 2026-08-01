import { describe, expect, it } from "vitest";
import {
	DEFAULT_HEADING,
	headingMatcher,
	normalizeHeading,
	spliceSection,
} from "./section";

describe("normalizeHeading", () => {
	it("keeps a well-formed heading, collapsing inner spaces", () => {
		expect(normalizeHeading("##   Schedule")).toBe("## Schedule");
		expect(normalizeHeading("  ## Schedule  ")).toBe("## Schedule");
	});

	it("preserves the heading level and multi-word titles", () => {
		expect(normalizeHeading("# My Day")).toBe("# My Day");
		expect(normalizeHeading("### Plan of attack")).toBe("### Plan of attack");
	});

	it("falls back to the default when there are no hashes or no title", () => {
		expect(normalizeHeading("Schedule")).toBe(DEFAULT_HEADING);
		expect(normalizeHeading("##")).toBe(DEFAULT_HEADING);
		expect(normalizeHeading("")).toBe(DEFAULT_HEADING);
	});
});

describe("headingMatcher", () => {
	it("matches only the exact level and title", () => {
		const m = headingMatcher("## Schedule");
		expect(m.test("## Schedule")).toBe(true);
		expect(m.test("## Schedule   ")).toBe(true); // trailing space tolerated
		expect(m.test("# Schedule")).toBe(false); // wrong level
		expect(m.test("### Schedule")).toBe(false);
		expect(m.test("## Schedule Extra")).toBe(false); // different title
	});

	it("does not treat the title as a regex", () => {
		const m = headingMatcher("## Plan (v2)");
		expect(m.test("## Plan (v2)")).toBe(true);
		expect(m.test("## Plan v2")).toBe(false);
	});
});

describe("spliceSection", () => {
	const section = "## Schedule\n\n- 09:00 - 10:00 Work\n";

	it("appends the section to an empty file (no separator)", () => {
		expect(spliceSection("", section, "## Schedule")).toBe(section);
	});

	it("appends after existing content with a blank-line separator", () => {
		const out = spliceSection("# Journal\n\nSlept well.\n", section, "## Schedule");
		expect(out).toBe("# Journal\n\nSlept well.\n\n## Schedule\n\n- 09:00 - 10:00 Work\n");
	});

	it("replaces an existing section, preserving surrounding content", () => {
		const before =
			"---\ntags: [daily]\n---\n\n## Schedule\n\n- 08:00 - 09:00 Old\n\n## Notes\n\nkeep me\n";
		const out = spliceSection(before, section, "## Schedule");
		expect(out).toContain("tags: [daily]");
		expect(out).toContain("- 09:00 - 10:00 Work");
		expect(out).not.toContain("Old");
		expect(out).toContain("## Notes");
		expect(out).toContain("keep me");
		// A blank line is kept between the section and the following heading.
		expect(out).toContain("- 09:00 - 10:00 Work\n\n## Notes");
	});

	it("honours a custom heading and leaves a differently-named heading alone", () => {
		const custom = "# My Day\n\n- 09:00 - 10:00 Work\n";
		const before = "# My Day\n\n- 07:00 - 08:00 Old\n\n## Schedule\n\nnot mine\n";
		const out = spliceSection(before, custom, "# My Day");
		expect(out).toContain("- 09:00 - 10:00 Work");
		expect(out).not.toContain("Old");
		// The unrelated "## Schedule" section is untouched.
		expect(out).toContain("## Schedule\n\nnot mine");
	});
});
