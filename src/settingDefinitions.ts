// The settings model and the single declarative description of every Kairos
// setting. Both render paths read this array: `getSettingDefinitions()` hands it
// straight to Obsidian 1.13+, and the legacy `display()` in settings.ts walks it
// to emit `new Setting(...)` calls for older builds. Keeping one array is what
// stops the two paths drifting apart.
//
// This module deliberately imports nothing from `obsidian` at runtime (the type
// import is erased at compile time), so it can be unit-tested in plain Node
// alongside the rest of the pure core.

import type {
	SettingDefinition,
	SettingDefinitionItem,
} from 'obsidian';
import { DEFAULT_HEADING } from './section';

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

	/**
	 * Group each Grid cell's tasks under the block they sit in, in start-time
	 * order with Unscheduled last (decision 70). On by default: it's what ties
	 * the Grid to the timelines. A setting because some workflows want the flat
	 * list instead.
	 */
	gridGroupByBlock: boolean;
	/**
	 * With block groups on, show a rolled-up task's project as a muted label at
	 * the end of its line on its domain's row (decision 74). Off by default.
	 */
	gridShowRollupProjects: boolean;
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
	gridGroupByBlock: true,
	gridShowRollupProjects: false,
};

/** Every control key is a settings property, so the default value resolver works. */
export type KairosSettingKey = Extract<keyof KairosSettings, string>;

/**
 * The settings, in the order they are rendered. The three timeline sliders sit
 * above the first heading, matching how the tab has always looked.
 */
export const SETTING_DEFINITIONS: SettingDefinitionItem<KairosSettingKey>[] = [
	{
		name: 'Timeline start hour',
		desc: 'First hour shown in the day view (0–23).',
		control: {
			type: 'slider',
			key: 'timelineStartHour',
			min: 0,
			max: 23,
			step: 1,
			defaultValue: DEFAULT_SETTINGS.timelineStartHour,
		},
	},
	{
		name: 'Timeline end hour',
		desc: 'Last hour shown in the day view (1–24).',
		control: {
			type: 'slider',
			key: 'timelineEndHour',
			min: 1,
			max: 24,
			step: 1,
			defaultValue: DEFAULT_SETTINGS.timelineEndHour,
		},
	},
	{
		name: 'Timeline hour height',
		desc: 'Pixels per hour in the day view.',
		control: {
			type: 'slider',
			key: 'timelineHourHeight',
			min: 30,
			max: 120,
			step: 5,
			defaultValue: DEFAULT_SETTINGS.timelineHourHeight,
		},
	},
	{
		type: 'group',
		heading: 'Week view',
		items: [
			{
				name: 'Days before today',
				desc: 'How many days before today the week view spans by default (1–7).',
				control: {
					type: 'slider',
					key: 'weekDaysBefore',
					min: 1,
					max: 7,
					step: 1,
					defaultValue: DEFAULT_SETTINGS.weekDaysBefore,
				},
			},
			{
				name: 'Days after today',
				desc: 'How many days after today the week view spans by default (1–7).',
				control: {
					type: 'slider',
					key: 'weekDaysAfter',
					min: 1,
					max: 7,
					step: 1,
					defaultValue: DEFAULT_SETTINGS.weekDaysAfter,
				},
			},
		],
	},
	{
		type: 'group',
		heading: 'Grid view',
		items: [
			{
				name: 'Group by block',
				desc:
					'Group the tasks in each grid cell under the block they sit in, ' +
					'in time order, with unscheduled tasks last.',
				control: {
					type: 'toggle',
					key: 'gridGroupByBlock',
					defaultValue: DEFAULT_SETTINGS.gridGroupByBlock,
				},
			},
			{
				name: 'Show projects on rolled-up tasks',
				desc:
					'On a domain row that includes rolled-up projects, show each ' +
					"task's project at the end of its line. Applies when grouping " +
					'by block.',
				control: {
					type: 'toggle',
					key: 'gridShowRollupProjects',
					defaultValue: DEFAULT_SETTINGS.gridShowRollupProjects,
				},
			},
		],
	},
	{
		type: 'group',
		heading: 'Daily notes',
		items: [
			{
				name: 'Schedule section heading',
				desc:
					'The daily-note heading Kairos reads and writes. Include the ' +
					'hashtags so you control the heading level (e.g. "## Schedule").',
				control: {
					type: 'text',
					key: 'scheduleHeading',
					placeholder: DEFAULT_HEADING,
					defaultValue: DEFAULT_SETTINGS.scheduleHeading,
				},
			},
		],
	},
	{
		type: 'group',
		heading: 'Associations',
		items: [
			{
				name: 'Ask when creating a block',
				desc:
					'Open the association picker as soon as a new block is created ' +
					'in the Day or Week view.',
				control: {
					type: 'toggle',
					key: 'askAssocOnBlockCreate',
					defaultValue: DEFAULT_SETTINGS.askAssocOnBlockCreate,
				},
			},
			{
				name: 'Ask when creating a backlog item',
				desc:
					'Open the association picker as soon as a new item is added to ' +
					'the backlog. Skipped when you create the item inside a ' +
					'project or domain group, which already sets its association.',
				control: {
					type: 'toggle',
					key: 'askAssocOnBacklogCreate',
					defaultValue: DEFAULT_SETTINGS.askAssocOnBacklogCreate,
				},
			},
		],
	},
	{
		type: 'group',
		heading: 'Folders',
		items: [
			{
				name: 'Projects folder',
				desc: 'Vault folder holding project files.',
				control: {
					type: 'text',
					key: 'projectsFolder',
					placeholder: DEFAULT_SETTINGS.projectsFolder,
					defaultValue: DEFAULT_SETTINGS.projectsFolder,
				},
			},
			{
				name: 'Domains folder',
				desc: 'Vault folder holding domain files.',
				control: {
					type: 'text',
					key: 'domainsFolder',
					placeholder: DEFAULT_SETTINGS.domainsFolder,
					defaultValue: DEFAULT_SETTINGS.domainsFolder,
				},
			},
			{
				name: 'Backlog file',
				desc: 'Vault path to the single global backlog file.',
				control: {
					type: 'text',
					key: 'backlogPath',
					placeholder: DEFAULT_SETTINGS.backlogPath,
					defaultValue: DEFAULT_SETTINGS.backlogPath,
				},
			},
		],
	},
];

/**
 * Depth-first list of the leaf definitions, groups flattened away. Used by the
 * legacy renderer's sibling test and by the drift test that checks every setting
 * is described exactly once.
 */
export function flattenSettingDefinitions(
	items: SettingDefinitionItem<KairosSettingKey>[] = SETTING_DEFINITIONS,
): SettingDefinition<KairosSettingKey>[] {
	const flat: SettingDefinition<KairosSettingKey>[] = [];
	for (const item of items) {
		if ('type' in item) {
			flat.push(...flattenSettingDefinitions(item.items ?? []));
			continue;
		}
		flat.push(item);
	}
	return flat;
}
