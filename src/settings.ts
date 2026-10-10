import { App, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinition, SettingDefinitionItem } from 'obsidian';
import Kairos from './main';
import { normalizeHeading } from './section';
import {
	SETTING_DEFINITIONS,
	type KairosSettingKey,
} from './settingDefinitions';

export { DEFAULT_SETTINGS } from './settingDefinitions';
export type { KairosSettings } from './settingDefinitions';

/**
 * The settings tab, rendered from the one array in settingDefinitions.ts.
 *
 * Obsidian 1.13 and later render the tab declaratively from
 * `getSettingDefinitions()`, which also puts every setting in the settings
 * search. Older builds never call that method and fall back to `display()`,
 * which walks the same array. Both paths write through `setControlValue`, so a
 * setting behaves identically whichever one rendered it.
 */
export class KairosSettingTab extends PluginSettingTab {
	plugin: Kairos;

	constructor(app: App, plugin: Kairos) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return SETTING_DEFINITIONS;
	}

	/**
	 * Every write from either render path. The inherited implementation mutates
	 * and persists `plugin.settings` directly, which would bypass
	 * `saveSettings()` and leave open Day/Week/Grid views showing stale settings;
	 * routing through `updateSettings` republishes the store so they re-derive.
	 * The per-key normalisation, the paired-hour clamp and the index reseed live
	 * here for the same reason: they have to happen on both Obsidian versions.
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key as KairosSettingKey) {
			case 'timelineStartHour': {
				const hour = Number(value);
				await this.plugin.updateSettings((s) => {
					s.timelineStartHour = hour;
					if (s.timelineEndHour <= hour) s.timelineEndHour = hour + 1;
				});
				return;
			}
			case 'timelineEndHour': {
				const hour = Number(value);
				await this.plugin.updateSettings((s) => {
					s.timelineEndHour = hour;
					if (s.timelineStartHour >= hour)
						s.timelineStartHour = hour - 1;
				});
				return;
			}
			case 'timelineHourHeight': {
				const height = Number(value);
				await this.plugin.updateSettings((s) => {
					s.timelineHourHeight = height;
				});
				return;
			}
			case 'weekDaysBefore': {
				const days = Number(value);
				await this.plugin.updateSettings((s) => {
					s.weekDaysBefore = days;
				});
				return;
			}
			case 'weekDaysAfter': {
				const days = Number(value);
				await this.plugin.updateSettings((s) => {
					s.weekDaysAfter = days;
				});
				return;
			}
			case 'scheduleHeading': {
				// Store the canonical form; an empty/invalid entry falls back to
				// the default so the engine always has a usable heading.
				const next = normalizeHeading(String(value));
				// Typing fires per keystroke and the reseed below is expensive,
				// so only act when the canonical heading actually moved.
				if (next === this.plugin.settings.scheduleHeading) return;
				await this.plugin.updateSettings((s) => {
					s.scheduleHeading = next;
				});
				// Days already in memory were parsed under the old heading;
				// rebuild the index so open views re-parse under the new one.
				await this.plugin.indexAdapter.reseed();
				return;
			}
			case 'projectsFolder': {
				const folder = normalizeFolder(String(value));
				await this.plugin.updateSettings((s) => {
					s.projectsFolder = folder;
				});
				return;
			}
			case 'domainsFolder': {
				const folder = normalizeFolder(String(value));
				await this.plugin.updateSettings((s) => {
					s.domainsFolder = folder;
				});
				return;
			}
			case 'backlogPath': {
				const path = normalizePath(String(value));
				await this.plugin.updateSettings((s) => {
					s.backlogPath = path;
				});
				return;
			}
			case 'askAssocOnBlockCreate': {
				const on = Boolean(value);
				await this.plugin.updateSettings((s) => {
					s.askAssocOnBlockCreate = on;
				});
				return;
			}
			case 'gridGroupByBlock': {
				const on = Boolean(value);
				await this.plugin.updateSettings((s) => {
					s.gridGroupByBlock = on;
				});
				return;
			}
			case 'gridShowRollupProjects': {
				const on = Boolean(value);
				await this.plugin.updateSettings((s) => {
					s.gridShowRollupProjects = on;
				});
				return;
			}
			case 'askAssocOnBacklogCreate': {
				const on = Boolean(value);
				await this.plugin.updateSettings((s) => {
					s.askAssocOnBacklogCreate = on;
				});
				return;
			}
		}
		// Not a key this tab describes. Store it anyway rather than dropping the
		// user's change, still through the one write path.
		await this.plugin.updateSettings((s) => {
			(s as unknown as Record<string, unknown>)[key] = value;
		});
	}

	/**
	 * Fallback renderer for Obsidian below 1.13.0, which has no declarative
	 * settings API. It emits the same settings, in the same order, from the same
	 * array. Delete this once the minimum app version reaches 1.13.0.
	 */
	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		this.renderDefinitions(containerEl, SETTING_DEFINITIONS);
	}

	private renderDefinitions(
		containerEl: HTMLElement,
		items: SettingDefinitionItem<KairosSettingKey>[],
	): void {
		for (const item of items) {
			if ('type' in item) {
				if (item.type !== 'group') {
					throw new Error(
						`Kairos settings: display() cannot render a "${item.type}" definition`,
					);
				}
				if (item.heading) {
					new Setting(containerEl).setName(item.heading).setHeading();
				}
				this.renderDefinitions(containerEl, item.items ?? []);
				continue;
			}
			this.renderDefinition(containerEl, item);
		}
	}

	private renderDefinition(
		containerEl: HTMLElement,
		def: SettingDefinition<KairosSettingKey>,
	): void {
		const control = def.control;
		if (!control) {
			throw new Error(
				`Kairos settings: display() cannot render "${def.name}" without a control`,
			);
		}

		const setting = new Setting(containerEl).setName(def.name);
		if (def.desc) setting.setDesc(def.desc);

		const current = this.plugin.settings[control.key];
		const commit = (value: unknown) => {
			void this.setControlValue(control.key, value);
		};

		switch (control.type) {
			case 'slider':
				setting.addSlider((slider) =>
					slider
						.setLimits(control.min, control.max, control.step)
						.setValue(Number(current))
						// Lints as deprecated against 1.13 typings, where the
						// value is always shown inline. This path only ever runs
						// below 1.13, where a slider without it shows no value at
						// all, so the call stays until display() goes away.
						.setDynamicTooltip()
						.onChange(commit),
				);
				break;
			case 'text':
				setting.addText((text) =>
					text
						.setPlaceholder(control.placeholder ?? '')
						.setValue(String(current))
						.onChange(commit),
				);
				break;
			case 'toggle':
				setting.addToggle((toggle) =>
					toggle.setValue(Boolean(current)).onChange(commit),
				);
				break;
			default:
				// A control type was added to the definitions without teaching
				// this renderer about it. Fail loudly rather than silently
				// dropping the setting for everyone below 1.13.0.
				throw new Error(
					`Kairos settings: display() cannot render a "${control.type}" control`,
				);
		}
	}
}

/** Trim whitespace and surrounding slashes so paths compare cleanly. */
function normalizePath(value: string): string {
	return value.trim().replace(/^\/+|\/+$/g, '');
}

/** Same as normalizePath; folders keep no trailing slash for prefix matching. */
function normalizeFolder(value: string): string {
	return normalizePath(value);
}
