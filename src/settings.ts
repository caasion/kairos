import { App, PluginSettingTab, Setting } from 'obsidian';
import Kairos from './main';
import { DEFAULT_HEADING, normalizeHeading } from './section';

export interface KairosSettings {
	/** First hour shown in the Day timeline (0–23). */
	timelineStartHour: number;
	/** Last hour shown in the Day timeline (1–24, must exceed start). */
	timelineEndHour: number;
	/** Pixels per hour in the Day timeline. */
	timelineHourHeight: number;

	/** Vault folder holding project files. */
	projectsFolder: string;
	/** Vault folder holding domain files. */
	domainsFolder: string;
	/** Vault path to the single global backlog file. */
	backlogPath: string;

	/**
	 * The daily-note section heading Kairos reads and writes, given verbatim with
	 * its hashtags so the user controls both the title and the heading level
	 * (e.g. "## Schedule", "# My Day", "### Plan").
	 */
	scheduleHeading: string;
}

export const DEFAULT_SETTINGS: KairosSettings = {
	timelineStartHour: 6,
	timelineEndHour: 24,
	timelineHourHeight: 60,
	projectsFolder: 'Projects',
	domainsFolder: 'Domains',
	backlogPath: 'Backlog.md',
	scheduleHeading: '## Schedule',
};

export class KairosSettingTab extends PluginSettingTab {
	plugin: Kairos;

	constructor(app: App, plugin: Kairos) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Timeline start hour')
			.setDesc('First hour shown in the Day view (0–23).')
			.addSlider((slider) =>
				slider
					.setLimits(0, 23, 1)
					.setValue(this.plugin.settings.timelineStartHour)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.timelineStartHour = value;
						if (
							this.plugin.settings.timelineEndHour <=
							value
						) {
							this.plugin.settings.timelineEndHour = value + 1;
						}
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Timeline end hour')
			.setDesc('Last hour shown in the Day view (1–24).')
			.addSlider((slider) =>
				slider
					.setLimits(1, 24, 1)
					.setValue(this.plugin.settings.timelineEndHour)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.timelineEndHour = value;
						if (
							this.plugin.settings.timelineStartHour >=
							value
						) {
							this.plugin.settings.timelineStartHour = value - 1;
						}
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Timeline hour height')
			.setDesc('Pixels per hour in the Day view.')
			.addSlider((slider) =>
				slider
					.setLimits(30, 120, 5)
					.setValue(this.plugin.settings.timelineHourHeight)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.timelineHourHeight = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('Daily notes').setHeading();

		new Setting(containerEl)
			.setName('Schedule section heading')
			.setDesc(
				'The daily-note heading Kairos reads and writes. Include the ' +
					'hashtags so you control the heading level (e.g. "## Schedule").',
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_HEADING)
					.setValue(this.plugin.settings.scheduleHeading)
					.onChange(async (value) => {
						// Store the canonical form; an empty/invalid entry falls back
						// to the default so the engine always has a usable heading.
						const next = normalizeHeading(value);
						if (next === this.plugin.settings.scheduleHeading) return;
						this.plugin.settings.scheduleHeading = next;
						await this.plugin.saveSettings();
						// Days already in memory were parsed under the old heading;
						// rebuild the index so open views re-parse under the new one.
						await this.plugin.indexAdapter.reseed();
					}),
			);

		new Setting(containerEl).setName('Folders').setHeading();

		new Setting(containerEl)
			.setName('Projects folder')
			.setDesc('Vault folder holding project files.')
			.addText((text) =>
				text
					.setPlaceholder('Projects')
					.setValue(this.plugin.settings.projectsFolder)
					.onChange(async (value) => {
						this.plugin.settings.projectsFolder =
							normalizeFolder(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Domains folder')
			.setDesc('Vault folder holding domain files.')
			.addText((text) =>
				text
					.setPlaceholder('Domains')
					.setValue(this.plugin.settings.domainsFolder)
					.onChange(async (value) => {
						this.plugin.settings.domainsFolder =
							normalizeFolder(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Backlog file')
			.setDesc('Vault path to the single global backlog file.')
			.addText((text) =>
				text
					.setPlaceholder('Backlog.md')
					.setValue(this.plugin.settings.backlogPath)
					.onChange(async (value) => {
						this.plugin.settings.backlogPath =
							normalizePath(value);
						await this.plugin.saveSettings();
					}),
			);
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
