import { App, PluginSettingTab, Setting } from 'obsidian';
import Kairos from './main';
import { DEFAULT_HEADING, normalizeHeading } from './section';

export interface KairosSettings {
	/** First hour shown in the day timeline (0–23). */
	timelineStartHour: number;
	/** Last hour shown in the day timeline (1–24, must exceed start). */
	timelineEndHour: number;
	/** Pixels per hour in the day timeline. */
	timelineHourHeight: number;

	/**
	 * Week view window, expressed as a span around today. The default window the
	 * Week view opens on is [today − weekDaysBefore, today + weekDaysAfter],
	 * inclusive; each side is 1–7 days. The view is still navigable past this
	 * default (arrows shift the window; "Today" snaps back to it).
	 */
	weekDaysBefore: number;
	weekDaysAfter: number;

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

	/**
	 * Open the association picker right after a new timeline block is created, so
	 * a block is filed the moment it exists instead of being left unassociated.
	 * Off by default — creating a block is a fast, repeated gesture and a popup
	 * on every one gets in the way unless you asked for it.
	 */
	askAssocOnBlockCreate: boolean;
	/**
	 * The same prompt after a new backlog item is created, but only when the
	 * item's association isn't already implied. Creating inside a project or
	 * domain group answers the question by where you created it.
	 */
	askAssocOnBacklogCreate: boolean;
}

export const DEFAULT_SETTINGS: KairosSettings = {
	timelineStartHour: 6,
	timelineEndHour: 24,
	timelineHourHeight: 60,
	weekDaysBefore: 1,
	weekDaysAfter: 5,
	projectsFolder: 'Projects',
	domainsFolder: 'Domains',
	backlogPath: 'Backlog.md',
	scheduleHeading: '## Schedule',
	askAssocOnBlockCreate: false,
	askAssocOnBacklogCreate: false,
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
			.setDesc('First hour shown in the day view (0–23).')
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
			.setDesc('Last hour shown in the day view (1–24).')
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
			.setDesc('Pixels per hour in the day view.')
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

		new Setting(containerEl).setName('Week view').setHeading();

		new Setting(containerEl)
			.setName('Days before today')
			.setDesc(
				'How many days before today the week view spans by default (1–7).',
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 7, 1)
					.setValue(this.plugin.settings.weekDaysBefore)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.weekDaysBefore = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Days after today')
			.setDesc(
				'How many days after today the week view spans by default (1–7).',
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 7, 1)
					.setValue(this.plugin.settings.weekDaysAfter)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.weekDaysAfter = value;
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

		new Setting(containerEl).setName('Associations').setHeading();

		new Setting(containerEl)
			.setName('Ask when creating a block')
			.setDesc(
				'Open the association picker as soon as a new block is created ' +
					'in the Day or Week view.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.askAssocOnBlockCreate)
					.onChange(async (value) => {
						this.plugin.settings.askAssocOnBlockCreate = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Ask when creating a backlog item')
			.setDesc(
				'Open the association picker as soon as a new item is added to ' +
					'the backlog. Skipped when you create the item inside a ' +
					'project or domain group, which already sets its association.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.askAssocOnBacklogCreate)
					.onChange(async (value) => {
						this.plugin.settings.askAssocOnBacklogCreate = value;
						await this.plugin.saveSettings();
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
