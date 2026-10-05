// Guards the one failure mode of dual-path settings: a setting that exists in
// the model but is described in neither render path, or a control type the
// legacy display() renderer in settings.ts does not know how to emit. Both show
// up as a setting silently missing on one Obsidian version or the other.

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SETTINGS,
	SETTING_DEFINITIONS,
	flattenSettingDefinitions,
} from './settingDefinitions';

const definitions = flattenSettingDefinitions(SETTING_DEFINITIONS);
const controls = definitions.flatMap((def) => (def.control ? [def.control] : []));

/** The control types settings.ts's display() fallback can render. */
const RENDERABLE_TYPES = ['slider', 'text', 'toggle'];

describe('setting definitions', () => {
	it('describes every setting exactly once', () => {
		const keys = controls.map((control) => control.key).sort();
		expect(keys).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
	});

	it('names no control key outside the settings model', () => {
		for (const control of controls) {
			expect(DEFAULT_SETTINGS).toHaveProperty(control.key);
		}
	});

	it('only uses control types the legacy renderer can emit', () => {
		for (const control of controls) {
			expect(RENDERABLE_TYPES).toContain(control.type);
		}
	});

	it('gives every setting a name and a description', () => {
		for (const def of definitions) {
			expect(def.name).toBeTruthy();
			expect(def.desc).toBeTruthy();
		}
	});

	it('keeps slider bounds around the default value', () => {
		for (const control of controls) {
			if (control.type !== 'slider') continue;
			const value = DEFAULT_SETTINGS[
				control.key
			] as unknown as number;
			expect(control.min).toBeLessThanOrEqual(value);
			expect(control.max).toBeGreaterThanOrEqual(value);
			expect((value - control.min) % control.step).toBe(0);
		}
	});
});
