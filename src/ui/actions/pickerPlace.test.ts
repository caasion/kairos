import { describe, expect, it } from "vitest";
import { placePanel } from "./pickerPlace";

const screen = { top: 0, left: 0, width: 400, height: 800 };
const panel = { width: 240, height: 260 };

describe("placePanel", () => {
	it("opens under the anchor when there's room", () => {
		expect(placePanel({ top: 100, bottom: 120, left: 50 }, panel, screen)).toEqual({ top: 126, left: 50 });
	});
	it("flips above when there's no room below", () => {
		expect(placePanel({ top: 600, bottom: 620, left: 50 }, panel, screen)).toEqual({ top: 334, left: 50 });
	});
	it("stays above the iOS keyboard, which shrinks the visual viewport", () => {
		// The keyboard leaves the top 450px visible; the anchor sits at 300.
		const visible = { top: 0, left: 0, width: 400, height: 450 };
		const at = placePanel({ top: 300, bottom: 320, left: 50 }, panel, visible);
		expect(at.top + panel.height).toBeLessThanOrEqual(450 - 6);
		expect(at.top).toBeGreaterThanOrEqual(6);
	});
	it("keeps the panel inside the right edge", () => {
		expect(placePanel({ top: 100, bottom: 120, left: 300 }, panel, screen).left).toBe(400 - 240 - 6);
	});
});
