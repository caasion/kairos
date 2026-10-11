import { describe, expect, it } from "vitest";
import { occursOn, parseRule, ruleKey } from "./rules";

// 2026-10-05 is a Monday.
const MON = "2026-10-05";
const TUE = "2026-10-06";
const SAT = "2026-10-10";
const SUN = "2026-10-11";

describe("parseRule", () => {
	it("reads daily, weekdays and weekends", () => {
		expect(parseRule("Daily")).toEqual({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6] });
		expect(parseRule("every day")).toEqual(parseRule("daily"));
		expect(parseRule("Weekdays")).toEqual({ kind: "weekly", days: [1, 2, 3, 4, 5] });
		expect(parseRule("every weekend")).toEqual({ kind: "weekly", days: [0, 6] });
	});

	it("reads lists of day names in several spellings", () => {
		const tueThu = { kind: "weekly", days: [2, 4] };
		expect(parseRule("Tue, Thu")).toEqual(tueThu);
		expect(parseRule("Tuesday and Thursday")).toEqual(tueThu);
		expect(parseRule("thu/tue")).toEqual(tueThu);
		expect(parseRule("every Sunday")).toEqual({ kind: "weekly", days: [0] });
		expect(parseRule("Mondays")).toEqual({ kind: "weekly", days: [1] });
	});

	it("reads monthly rules", () => {
		expect(parseRule("monthly on 1")).toEqual({ kind: "monthly", day: 1 });
		expect(parseRule("Monthly on the 15th")).toEqual({ kind: "monthly", day: 15 });
		expect(parseRule("every month on 3")).toEqual({ kind: "monthly", day: 3 });
		expect(parseRule("monthly on 32")).toBeUndefined();
	});

	it("rejects text that isn't a rule", () => {
		expect(parseRule("Notes")).toBeUndefined();
		expect(parseRule("")).toBeUndefined();
		expect(parseRule("every 3 days")).toBeUndefined();
	});
});

describe("occursOn", () => {
	it("matches weekdays by the local calendar", () => {
		const weekdays = parseRule("weekdays")!;
		expect(occursOn(weekdays, MON)).toBe(true);
		expect(occursOn(weekdays, SAT)).toBe(false);
		const weekends = parseRule("weekends")!;
		expect(occursOn(weekends, SAT)).toBe(true);
		expect(occursOn(weekends, SUN)).toBe(true);
		expect(occursOn(parseRule("tue")!, TUE)).toBe(true);
		expect(occursOn(parseRule("tue")!, MON)).toBe(false);
	});

	it("matches a monthly day and skips months without it", () => {
		const fifth = parseRule("monthly on 5")!;
		expect(occursOn(fifth, MON)).toBe(true);
		expect(occursOn(fifth, TUE)).toBe(false);
		const thirtyFirst = parseRule("monthly on 31")!;
		expect(occursOn(thirtyFirst, "2026-10-31")).toBe(true);
		expect(occursOn(thirtyFirst, "2026-11-30")).toBe(false);
	});
});

describe("ruleKey", () => {
	it("is the same for different spellings of one rule", () => {
		expect(ruleKey(parseRule("Tue, Thu")!)).toBe(ruleKey(parseRule("thursday and tuesday")!));
	});
});
