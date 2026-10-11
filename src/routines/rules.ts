// Recurrence rules — the fixed-calendar vocabulary a routine can repeat on.
//
// A rule is written in plain words, either as a `##` heading in the routines
// file (a default for every line under it) or after a `🔁` on one line. Only
// fixed calendar rules exist for now: a routine comes back on schedule whether
// or not you did the last one. "Every N days after done" is deliberately out.
//
// Vocabulary (case-insensitive; a leading "every" is always optional):
//   daily | every day | everyday
//   weekdays | every weekday            Mon–Fri
//   weekends | every weekend            Sat, Sun
//   Tue, Thu | Mon/Wed/Fri | Tuesday and Thursday | every Sunday
//   monthly on 1 | monthly on the 15th | every month on 3
//
// A monthly day that a month doesn't have (the 31st in April) simply doesn't
// occur that month. Pure and vault-free.

import type { ISODate } from "../types";

export type Rule =
	| { kind: "weekly"; days: number[] } // 0 = Sunday … 6 = Saturday, sorted
	| { kind: "monthly"; day: number }; // 1–31

const DAY_NAMES: Record<string, number> = {
	sun: 0, sunday: 0,
	mon: 1, monday: 1,
	tue: 2, tues: 2, tuesday: 2,
	wed: 3, weds: 3, wednesday: 3,
	thu: 4, thur: 4, thurs: 4, thursday: 4,
	fri: 5, friday: 5,
	sat: 6, saturday: 6,
};

const MONTHLY = /^(?:monthly|month)\s+on\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/;

/** Parse rule text; undefined when it isn't a rule (e.g. a heading like "Notes"). */
export function parseRule(text: string): Rule | undefined {
	let t = text.trim().toLowerCase().replace(/\s+/g, " ");
	t = t.replace(/^every\s+/, "");
	if (!t) return undefined;

	if (t === "day" || t === "daily" || t === "everyday") {
		return { kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6] };
	}
	if (t === "weekday" || t === "weekdays") {
		return { kind: "weekly", days: [1, 2, 3, 4, 5] };
	}
	if (t === "weekend" || t === "weekends") {
		return { kind: "weekly", days: [0, 6] };
	}

	const m = MONTHLY.exec(t);
	if (m) {
		const day = Number(m[1]);
		return day >= 1 && day <= 31 ? { kind: "monthly", day } : undefined;
	}

	// A list of day names: "tue, thu", "mon/wed/fri", "tuesday and thursday".
	const parts = t.split(/\s*(?:,|\/|&|\band\b|\s)\s*/).filter(Boolean);
	if (parts.length === 0) return undefined;
	const days = new Set<number>();
	for (const part of parts) {
		const day = DAY_NAMES[part.replace(/s$/, "")] ?? DAY_NAMES[part];
		if (day === undefined) return undefined;
		days.add(day);
	}
	return { kind: "weekly", days: [...days].sort((a, b) => a - b) };
}

/** Does `rule` occur on `date` (YYYY-MM-DD)? */
export function occursOn(rule: Rule, date: ISODate): boolean {
	const [y, m, d] = date.split("-").map(Number);
	if (y === undefined || m === undefined || d === undefined) return false;
	if (rule.kind === "monthly") return d === rule.day;
	// Local calendar weekday; the Date is only used for its day-of-week.
	const weekday = new Date(y, m - 1, d).getDay();
	return rule.days.includes(weekday);
}

/** A canonical string for a rule — stable across spellings of the same rule. */
export function ruleKey(rule: Rule): string {
	return rule.kind === "monthly" ? `m:${rule.day}` : `w:${rule.days.join(",")}`;
}

const SHORT_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Monday-first position of a weekday (Mon 0 … Sun 6), for display order. */
export function mondayFirst(day: number): number {
	return (day + 6) % 7;
}

/** The short name of a weekday (0 = Sunday): "Sun" … "Sat". */
export function weekdayName(day: number): string {
	return SHORT_NAMES[day] ?? "";
}

/**
 * The canonical way to write a rule — what Kairos puts in a heading it creates
 * and what the Routines view names a group: "Daily", "Weekdays", "Weekends",
 * "Mon, Wed", "Monthly on 1". `parseRule(ruleText(r))` is always `r`.
 */
export function ruleText(rule: Rule): string {
	if (rule.kind === "monthly") return `Monthly on ${rule.day}`;
	const key = rule.days.join(",");
	if (key === "0,1,2,3,4,5,6") return "Daily";
	if (key === "1,2,3,4,5") return "Weekdays";
	if (key === "0,6") return "Weekends";
	return [...rule.days]
		.sort((a, b) => mondayFirst(a) - mondayFirst(b))
		.map(weekdayName)
		.join(", ");
}

/** A rule as it reads mid-sentence: "daily", "on weekdays", "on Mon, Wed", "monthly on 1". */
export function ruleSentence(rule: Rule): string {
	const text = ruleText(rule);
	if (text === "Daily") return "daily";
	if (text === "Weekdays" || text === "Weekends") return `on ${text.toLowerCase()}`;
	if (rule.kind === "monthly") return `monthly on ${rule.day}`;
	return `on ${text}`;
}

/**
 * Display order for rule groups: Daily, Weekdays, Weekends, then day lists by
 * their first weekday (Monday first, fewer days before more), then monthly
 * rules by day of month.
 */
export function compareRules(a: Rule, b: Rule): number {
	return ruleRank(a) - ruleRank(b) || ruleText(a).localeCompare(ruleText(b));
}

function ruleRank(rule: Rule): number {
	if (rule.kind === "monthly") return 1000 + rule.day;
	const key = rule.days.join(",");
	if (key === "0,1,2,3,4,5,6") return 0;
	if (key === "1,2,3,4,5") return 1;
	if (key === "0,6") return 2;
	const first = Math.min(...rule.days.map(mondayFirst));
	return 10 + first * 10 + rule.days.length;
}
