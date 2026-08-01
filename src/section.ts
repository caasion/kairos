// Schedule-section heading — the single source of truth for how Kairos finds,
// bounds, and splices its section inside a daily note.
//
// The heading is user-configurable (settings.scheduleHeading), given verbatim
// *with* its hashtags, e.g. "## Schedule" or "# My Day". Both the level (hash
// count) and the title are honoured: a note whose heading is at a different
// level than configured is not the Kairos section.
//
// Everything that touches the heading — the parser, the serializer, and the
// splice-on-write — routes through here, so there is exactly one place that
// knows the heading's shape. This module is pure (no Obsidian, no I/O) so the
// splice is unit-testable in isolation.

/** The default section heading, used when the setting is empty/unset. */
export const DEFAULT_HEADING = "## Schedule";

/** Any ATX heading line (used to find where a section ends). */
export const ANY_HEADING = /^#{1,6}\s/;

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize a user-supplied heading into its canonical single-line form. Trims
 * surrounding whitespace and collapses inner runs of spaces after the hashes so
 * "##   Schedule " and "## Schedule" behave identically. Falls back to the
 * default when the input has no hashes or no title.
 */
export function normalizeHeading(heading: string): string {
	const trimmed = heading.trim();
	const m = /^(#{1,6})\s+(.+?)\s*$/.exec(trimmed);
	if (!m) return DEFAULT_HEADING;
	return `${m[1]} ${m[2]}`;
}

/**
 * A matcher for the configured heading line. Matches the exact hash level and
 * title (title compared case-sensitively, trailing whitespace tolerated).
 */
export function headingMatcher(heading: string): RegExp {
	const norm = normalizeHeading(heading);
	const m = /^(#{1,6})\s+(.+)$/.exec(norm);
	// `norm` is always a valid heading (normalizeHeading guarantees it), so this
	// match cannot fail; the fallback keeps TS — and us — honest.
	const hashes = m?.[1] ?? "##";
	const title = m?.[2] ?? "Schedule";
	return new RegExp(`^${escapeRegExp(hashes)}\\s+${escapeRegExp(title)}\\s*$`);
}

interface SectionBounds {
	headingLine: number; // index of the section heading line
	end: number; // index one past the last line of the section
}

/**
 * Find the section's line range: from its heading through the line before the
 * next heading of any level (or EOF). Undefined when the section is absent.
 */
export function sectionBounds(
	lines: string[],
	heading: string,
): SectionBounds | undefined {
	const matcher = headingMatcher(heading);
	let headingLine = -1;
	for (let i = 0; i < lines.length; i++) {
		if (matcher.test(lines[i] ?? "")) {
			headingLine = i;
			break;
		}
	}
	if (headingLine === -1) return undefined;

	let end = lines.length;
	for (let i = headingLine + 1; i < lines.length; i++) {
		if (ANY_HEADING.test(lines[i] ?? "")) {
			end = i;
			break;
		}
	}
	return { headingLine, end };
}

/**
 * Replace the section of `text` with `section` (itself a complete heading block
 * ending in a trailing newline). When the section is absent, append it after a
 * blank-line separator. Everything outside the section — frontmatter, prose,
 * other headings — is preserved untouched.
 *
 * Returns the full new file text.
 */
export function spliceSection(
	text: string,
	section: string,
	heading: string,
): string {
	const lines = text.split(/\r?\n/);
	const bounds = sectionBounds(lines, heading);

	if (!bounds) {
		// No section yet: append, keeping a blank line between existing content
		// and the new heading (unless the file is empty).
		const trimmed = text.replace(/\s*$/, "");
		const prefix = trimmed.length > 0 ? trimmed + "\n\n" : "";
		return prefix + section;
	}

	const before = lines.slice(0, bounds.headingLine);
	const after = lines.slice(bounds.end);

	// `section` ends with a newline; splitting it drops the trailing empty entry.
	const sectionLines = section.replace(/\n$/, "").split("\n");

	// Keep a single blank line between the section and whatever heading follows,
	// so the rewrite doesn't butt the section straight up against the next "##".
	if (after.length > 0 && ANY_HEADING.test(after[0] ?? "")) {
		sectionLines.push("");
	}

	return [...before, ...sectionLines, ...after].join("\n");
}
