import { MarkdownView, Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, KairosSettingTab } from './settings';
import type { KairosSettings } from './settings';
import { parseSchedule } from './parser';

export default class Kairos extends Plugin {
	settings!: KairosSettings;

	async onload() {
		await this.loadSettings();

		// Dev command: parse the active note's Schedule section and log the JSON.
		this.addCommand({
			id: 'test-parse-active-file',
			name: 'Test: parse active file schedule',
			checkCallback: (checking: boolean) => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				const file = view?.file;
				if (!file) return false;

				if (!checking) void this.testParse();
				return true;
			},
		});

		this.addSettingTab(new KairosSettingTab(this.app, this));
	}

	onunload() {}

	private async testParse() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('Kairos: no active file');
			return;
		}

		const markdown = await this.app.vault.read(file);
		const blocks = parseSchedule(markdown, file.path);

		console.log(`[Kairos] parsed ${blocks.length} block(s) from ${file.path}`);
		console.log(JSON.stringify(blocks, null, 2));
		new Notice(`Kairos: parsed ${blocks.length} block(s) — see console`);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<KairosSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
