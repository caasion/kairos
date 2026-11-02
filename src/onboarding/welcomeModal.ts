// The tour's front door: what Kairos asks of you, what the tour will do to your
// notes, and a way out. Opens once, the first time a Kairos view opens, and
// again whenever "Start tour" runs.

import { App, Modal, Setting } from "obsidian";
import { appHasDailyNotesPluginLoaded } from "obsidian-daily-notes-interface";

export class WelcomeModal extends Modal {
	private started = false;

	constructor(
		app: App,
		private readonly onStart: () => void,
		private readonly onNotNow: () => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		this.setTitle("Welcome to Kairos");
		contentEl.addClass("kairos-tour-welcome");

		contentEl.createEl("p", {
			text: "Kairos asks one thing of you: decide when the work happens. This short tour plans a piece of your real day, about two minutes.",
		});
		contentEl.createEl("p", {
			text: "What you make goes in today's daily note. At the end you can keep it or remove it.",
		});
		if (!appHasDailyNotesPluginLoaded()) {
			contentEl.createEl("p", {
				cls: "kairos-tour-welcome-note",
				text: "Daily notes isn't turned on, so Kairos uses its default folder and date format. To choose your own, turn on Daily notes in Settings → Core plugins.",
			});
		}

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Not now").onClick(() => this.close()),
			)
			.addButton((b) =>
				b
					.setButtonText("Start the tour")
					.setCta()
					.onClick(() => {
						this.started = true;
						this.close();
					}),
			);
	}

	onClose() {
		this.contentEl.empty();
		if (this.started) this.onStart();
		else this.onNotNow();
	}
}
