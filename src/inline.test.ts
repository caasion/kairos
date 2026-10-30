import { describe, expect, it } from "vitest";
import { isPlain, parseInline, plainText, type Inline } from "./inline";
import { parseSchedule } from "./parser";

const t = (text: string): Inline => ({ kind: "text", text });
const link = (target: string, label = target): Inline => ({
	kind: "internal",
	target,
	children: [t(label)],
});
const web = (url: string, children: Inline[] = [t(url)]): Inline => ({
	kind: "external",
	url,
	children,
});

describe("parseInline: plain text", () => {
	it("keeps text without markup as one piece", () => {
		expect(parseInline("Call mom")).toEqual([t("Call mom")]);
		expect(parseInline("")).toEqual([]);
		expect(isPlain(parseInline("Call mom"))).toBe(true);
	});

	it("caches by text", () => {
		expect(parseInline("Read **this**")).toBe(parseInline("Read **this**"));
	});

	it("leaves lone markers as text", () => {
		expect(parseInline("2 * 3 = 6")).toEqual([t("2 * 3 = 6")]);
		expect(parseInline("a == b")).toEqual([t("a == b")]);
		expect(parseInline("~approx")).toEqual([t("~approx")]);
		expect(parseInline("snake_case_name")).toEqual([t("snake_case_name")]);
		expect(parseInline("trailing *")).toEqual([t("trailing *")]);
	});
});

describe("parseInline: links", () => {
	it("reads wikilinks, aliases, headings and embeds", () => {
		expect(parseInline("See [[Note]]")).toEqual([t("See "), link("Note")]);
		expect(parseInline("[[Note|the note]]")).toEqual([link("Note", "the note")]);
		expect(parseInline("[[Note#Plan]]")).toEqual([link("Note#Plan", "Note > Plan")]);
		expect(parseInline("![[Pic.png]]")).toEqual([link("Pic.png")]);
		expect(parseInline("[[Note\\|alias]]")).toEqual([link("Note", "alias")]);
	});

	it("reads adjacent links separately", () => {
		expect(parseInline("[[A]][[B]]")).toEqual([link("A"), link("B")]);
		expect(parseInline("[[A]] and [x](https://x.io)")).toEqual([
			link("A"),
			t(" and "),
			web("https://x.io", [t("x")]),
		]);
	});

	it("leaves unclosed or empty wikilinks as text", () => {
		expect(parseInline("[[Note")).toEqual([t("[[Note")]);
		expect(parseInline("[[]]")).toEqual([t("[[]]")]);
	});

	it("reads markdown links to the web and to notes", () => {
		expect(parseInline("[docs](https://example.com/a?b=1)")).toEqual([
			web("https://example.com/a?b=1", [t("docs")]),
		]);
		expect(parseInline("[plan](My%20Plan.md#Goals)")).toEqual([
			{ kind: "internal", target: "My Plan#Goals", children: [t("plan")] },
		]);
		expect(parseInline('[d](<a b.md> "title")')).toEqual([
			{ kind: "internal", target: "a b", children: [t("d")] },
		]);
	});

	it("keeps balanced parentheses in a link's destination", () => {
		expect(parseInline("[Foo](https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual([
			web("https://en.wikipedia.org/wiki/Foo_(bar)", [t("Foo")]),
		]);
	});

	it("never links an unsafe scheme", () => {
		expect(parseInline("[x](javascript:alert(1))")).toEqual([t("x")]);
		expect(parseInline("[x](file:///etc/passwd)")).toEqual([t("x")]);
	});

	it("reads markup in a link's label", () => {
		expect(parseInline("[**big** news](https://n.io)")).toEqual([
			web("https://n.io", [{ kind: "strong", children: [t("big")] }, t(" news")]),
		]);
	});

	it("reads bare URLs without trailing punctuation", () => {
		expect(parseInline("Go to https://example.com.")).toEqual([
			t("Go to "),
			web("https://example.com"),
			t("."),
		]);
		expect(parseInline("(see https://example.com)")).toEqual([
			t("(see "),
			web("https://example.com"),
			t(")"),
		]);
		expect(parseInline("https://en.wikipedia.org/wiki/Foo_(bar) x")).toEqual([
			web("https://en.wikipedia.org/wiki/Foo_(bar)"),
			t(" x"),
		]);
	});

	it("doesn't read a URL glued to a word", () => {
		expect(parseInline("xhttps://a.io")).toEqual([t("xhttps://a.io")]);
	});
});

describe("parseInline: formatting", () => {
	it("reads each kind", () => {
		expect(parseInline("`x` **b** __b__ *i* _i_ ~~s~~ ==h==")).toEqual([
			{ kind: "code", text: "x" },
			t(" "),
			{ kind: "strong", children: [t("b")] },
			t(" "),
			{ kind: "strong", children: [t("b")] },
			t(" "),
			{ kind: "em", children: [t("i")] },
			t(" "),
			{ kind: "em", children: [t("i")] },
			t(" "),
			{ kind: "del", children: [t("s")] },
			t(" "),
			{ kind: "mark", children: [t("h")] },
		]);
	});

	it("nests", () => {
		expect(parseInline("**a *b* c**")).toEqual([
			{ kind: "strong", children: [t("a "), { kind: "em", children: [t("b")] }, t(" c")] },
		]);
		expect(parseInline("*a **b** c*")).toEqual([
			{ kind: "em", children: [t("a "), { kind: "strong", children: [t("b")] }, t(" c")] },
		]);
		expect(parseInline("***both***")).toEqual([
			{ kind: "em", children: [{ kind: "strong", children: [t("both")] }] },
		]);
		expect(parseInline("**bold *it***")).toEqual([
			{ kind: "strong", children: [t("bold "), { kind: "em", children: [t("it")] }] },
		]);
		expect(parseInline("==~~x~~==")).toEqual([
			{ kind: "mark", children: [{ kind: "del", children: [t("x")] }] },
		]);
	});

	it("reads adjacent spans", () => {
		expect(parseInline("**a** **b**")).toEqual([
			{ kind: "strong", children: [t("a")] },
			t(" "),
			{ kind: "strong", children: [t("b")] },
		]);
		expect(parseInline("*a*`b`")).toEqual([
			{ kind: "em", children: [t("a")] },
			{ kind: "code", text: "b" },
		]);
	});

	it("reads a link inside bold, and doesn't close bold inside the link", () => {
		expect(parseInline("**see [[Note]]**")).toEqual([
			{ kind: "strong", children: [t("see "), link("Note")] },
		]);
		expect(parseInline("**see [[a**b]] now**")).toEqual([
			{ kind: "strong", children: [t("see "), link("a**b"), t(" now")] },
		]);
	});

	it("leaves unclosed markers as text", () => {
		expect(parseInline("**open")).toEqual([t("**open")]);
		expect(parseInline("*open")).toEqual([t("*open")]);
		expect(parseInline("`open")).toEqual([t("`open")]);
		expect(parseInline("==open")).toEqual([t("==open")]);
		expect(parseInline("** spaced **")).toEqual([t("** spaced **")]);
	});

	it("keeps markup inside code as text", () => {
		expect(parseInline("`**x** [[y]]`")).toEqual([{ kind: "code", text: "**x** [[y]]" }]);
		expect(parseInline("``a ` b``")).toEqual([{ kind: "code", text: "a ` b" }]);
		expect(parseInline("*a `*` b*")).toEqual([
			{ kind: "em", children: [t("a "), { kind: "code", text: "*" }, t(" b")] },
		]);
	});

	it("honours backslash escapes", () => {
		expect(parseInline("\\*not em\\*")).toEqual([t("*not em*")]);
		expect(parseInline("\\[[x]]")).toEqual([t("[[x]]")]);
		expect(parseInline("\\#notag")).toEqual([t("#notag")]);
		expect(parseInline("a \\ b")).toEqual([t("a \\ b")]);
	});
});

describe("parseInline: tags", () => {
	it("reads #tag at the start or after a space", () => {
		expect(parseInline("#work call")).toEqual([{ kind: "tag", tag: "work" }, t(" call")]);
		expect(parseInline("call #area/home-2")).toEqual([
			t("call "),
			{ kind: "tag", tag: "area/home-2" },
		]);
		expect(parseInline("#日本語")).toEqual([{ kind: "tag", tag: "日本語" }]);
	});

	it("leaves # in ordinary text alone", () => {
		expect(parseInline("issue#12")).toEqual([t("issue#12")]);
		expect(parseInline("#12 bug")).toEqual([t("#12 bug")]);
		expect(parseInline("# heading")).toEqual([t("# heading")]);
		expect(parseInline("C# code")).toEqual([t("C# code")]);
	});

	it("doesn't read a link's #heading as a tag", () => {
		expect(parseInline("[[Note#Plan]]")).toEqual([link("Note#Plan", "Note > Plan")]);
	});
});

describe("parseInline and Kairos's own line syntax", () => {
	it("leaves associations and paren notes in the middle of text alone", () => {
		expect(parseInline("Call [Mom] about (the trip)")).toEqual([
			t("Call [Mom] about (the trip)"),
		]);
		expect(parseInline("Plan [D:Home] stuff")).toEqual([t("Plan [D:Home] stuff")]);
	});

	it("gets titles with the time, associations and note already peeled off", () => {
		const md = [
			"## Schedule",
			"- 09:00 - 10:00 Deep work on [[Kairos]] [Kairos] (focus)",
			"\t- [ ] Read [the docs](https://docs.obsidian.md) [D:Learn]",
			"\t- [x] Fix **bug** #kairos [Kairos] (urgent)",
			"\t- [ ] Read https://en.wikipedia.org/wiki/Foo_(bar)",
			"\t- [ ] Write [Kairos] (draft)",
			"",
		].join("\n");
		const [block] = parseSchedule(md, "d.md");
		expect(block?.title).toBe("Deep work on [[Kairos]]");
		expect(block?.assoc).toEqual({ kind: "project", id: "Kairos" });
		expect(block?.metadata).toBe("focus");
		const [docs, fix, wiki, draft] = block!.tasks;
		expect(docs?.text).toBe("Read [the docs](https://docs.obsidian.md)");
		expect(docs?.assoc).toEqual({ kind: "domain", id: "Learn" });
		expect(parseInline(docs!.text)).toEqual([
			t("Read "),
			web("https://docs.obsidian.md", [t("the docs")]),
		]);
		expect(fix?.text).toBe("Fix **bug** #kairos");
		expect(fix?.metadata).toBe("urgent");
		expect(wiki?.text).toBe("Read https://en.wikipedia.org/wiki/Foo_(bar)");
		expect(wiki?.metadata).toBeUndefined();
		// A paren note glued to an association still reads as before.
		expect(draft?.text).toBe("Write");
		expect(draft?.assoc).toEqual({ kind: "project", id: "Kairos" });
		expect(draft?.metadata).toBe("draft");
	});
});

describe("plainText", () => {
	it("drops markup and keeps what shows", () => {
		expect(plainText(parseInline("**Read** [[Note|it]] `x` #t"))).toBe("Read it x #t");
	});
});

describe("parseInline speed", () => {
	it("parses a few hundred rows quickly", () => {
		const rows = Array.from(
			{ length: 500 },
			(_, i) => `Task ${i} with **bold**, [[Note ${i}|alias]], https://x.io/${i} and #tag${i}`,
		);
		const start = performance.now();
		for (const r of rows) parseInline(r);
		const cold = performance.now() - start;
		const again = performance.now();
		for (const r of rows) parseInline(r);
		const warm = performance.now() - again;
		expect(cold).toBeLessThan(100);
		expect(warm).toBeLessThan(10);
	});
});
