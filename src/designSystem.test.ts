// Keeps the design system (DESIGN.md) moving one way.
//
// Each view used to copy another view's CSS and then change its copy, so the
// same thing (a frameless icon button, a group heading, a count) looked
// slightly different everywhere. The fix is shared components and tokens, and
// moving views onto them takes many small changes. This test counts the
// patterns those changes remove, in every component, and fails if a count
// rises above its baseline. New code can't add to the drift, and each move
// onto a component lowers a count.
//
// When a change lowers a count, lower its baseline here to match. The test
// prints the counts it found.

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return svelteFiles(path);
		return name.endsWith(".svelte") ? [path] : [];
	});
}

const sources = svelteFiles(join(ROOT, "src")).map((path) => ({
	file: relative(ROOT, path),
	text: readFileSync(path, "utf8"),
}));

interface Drift {
	/** What the pattern is, and what replaces it. */
	what: string;
	pattern: RegExp;
	baseline: number;
}

// Baselines as of 2026-10-29, on top of 1.1.0.
const DRIFT: Drift[] = [
	{
		what: "Hex colours: use an Obsidian colour variable (--color-green, --text-muted, …)",
		pattern: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g,
		baseline: 17,
	},
	{
		what: "Font sizes in px: use a --kairos-text-* token or Obsidian's --font-ui-*",
		pattern: /font-size:\s*\d+px/g,
		baseline: 116,
	},
	{
		what: "Corner radii in px: use a --kairos-radius-* token",
		pattern: /border-radius:\s*\d+px/g,
		baseline: 78,
	},
	{
		what: "Inline SVG icons: use IconButton or the icon action (Obsidian's icons)",
		pattern: /<svg\b/g,
		baseline: 104,
	},
	{
		what: "Hand-made frameless buttons (box-shadow: none): use IconButton",
		pattern: /box-shadow:\s*none/g,
		baseline: 50,
	},
	{
		what: "Serif font stack typed out: use --kairos-font-serif",
		pattern: /Georgia/g,
		baseline: 0,
	},
	{
		what: ":global() in a component: global CSS belongs in styles.css",
		pattern: /:global\(/g,
		baseline: 48,
	},
];

function count(pattern: RegExp): { total: number; byFile: string[] } {
	const byFile: string[] = [];
	let total = 0;
	for (const { file, text } of sources) {
		const n = text.match(pattern)?.length ?? 0;
		if (n > 0) byFile.push(`${n}\t${file}`);
		total += n;
	}
	return { total, byFile: byFile.sort((a, b) => parseInt(b) - parseInt(a)) };
}

describe("design system drift only goes down", () => {
	for (const drift of DRIFT) {
		it(drift.what, () => {
			const { total, byFile } = count(drift.pattern);
			expect(
				total,
				`${drift.what}\nFound ${total}, baseline ${drift.baseline}:\n${byFile.join("\n")}`,
			).toBeLessThanOrEqual(drift.baseline);
		});
	}
});

describe("design system components", () => {
	it("styles.css defines every token DESIGN.md lists", () => {
		const css = readFileSync(join(ROOT, "styles.css"), "utf8");
		const design = readFileSync(join(ROOT, "DESIGN.md"), "utf8");
		const listed = [...design.matchAll(/`(--kairos-[a-z-]+)`/g)].map((m) => m[1]);
		expect(listed.length).toBeGreaterThan(0);
		for (const token of new Set(listed)) {
			expect(css, `${token} is in DESIGN.md but not styles.css`).toContain(`${token}:`);
		}
	});
});
