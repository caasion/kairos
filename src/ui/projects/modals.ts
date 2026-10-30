// Small native Obsidian modals the Projects & Domains page uses in place of the
// browser's `window.prompt` / `window.confirm`, which Obsidian's Electron sandbox
// disables (they throw "prompt() is not supported"). Both resolve through a
// callback, matching the DomainReorderModal style. They use Obsidian's own
// modal parts (its title, `modal-button-container`, `mod-cta`/`mod-warning`
// buttons) so they look like Obsidian's dialogs; the little styling they add
// lives in styles.css under `.kairos-modal-*`.

/** Obsidian's row of dialog buttons, right-aligned at the bottom. */
function buttonRow(parent: HTMLElement): HTMLElement {
	return parent.createDiv({ cls: "modal-button-container" });
}

import { App, ButtonComponent, Modal, Setting } from "obsidian";

/**
 * A single-line text prompt. Calls `onSubmit` with the trimmed value when the
 * user confirms (Enter or the primary button); a cancel or empty value does
 * nothing. Replaces `window.prompt`.
 */
export class PromptModal extends Modal {
	private value: string;
	private readonly title: string;
	private readonly placeholder: string;
	private readonly cta: string;
	private readonly allowEmpty: boolean;
	private readonly onSubmit: (value: string) => void;

	constructor(
		app: App,
		opts: {
			title: string;
			placeholder?: string;
			initial?: string;
			cta?: string;
			allowEmpty?: boolean;
			onSubmit: (value: string) => void;
		},
	) {
		super(app);
		this.title = opts.title;
		this.placeholder = opts.placeholder ?? "";
		this.value = opts.initial ?? "";
		this.cta = opts.cta ?? "Create";
		this.allowEmpty = opts.allowEmpty ?? false;
		this.onSubmit = opts.onSubmit;
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title);

		const setting = new Setting(contentEl).addText((text) => {
			text
				.setPlaceholder(this.placeholder)
				.setValue(this.value)
				.onChange((v) => (this.value = v));
			text.inputEl.addClass("kairos-modal-input");
			// Enter submits.
			text.inputEl.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter") {
					ev.preventDefault();
					this.submit();
				}
			});
			// Focus + select for a rename-friendly flow.
			window.setTimeout(() => {
				text.inputEl.focus();
				text.inputEl.select();
			}, 0);
		});
		setting.settingEl.addClass("kairos-modal-field");

		const buttons = buttonRow(contentEl);
		new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
		new ButtonComponent(buttons)
			.setButtonText(this.cta)
			.setCta()
			.onClick(() => this.submit());
	}

	private submit() {
		const next = this.value.trim();
		if (next === "" && !this.allowEmpty) return;
		this.close();
		this.onSubmit(next);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * A yes/no confirmation with a (possibly multi-line) message. Calls `onConfirm`
 * only when the user picks the confirm button. Replaces `window.confirm`; the
 * confirm button is styled as a warning for destructive actions.
 */
export class ConfirmModal extends Modal {
	private readonly title: string;
	private readonly message: string;
	private readonly cta: string;
	private readonly danger: boolean;
	private readonly onConfirm: () => void;
	private readonly alt?: { text: string; onClick: () => void };

	constructor(
		app: App,
		opts: {
			title: string;
			message: string;
			cta?: string;
			danger?: boolean;
			onConfirm: () => void;
			/** A gentler choice, shown between Cancel and the confirm button. */
			alt?: { text: string; onClick: () => void };
		},
	) {
		super(app);
		this.title = opts.title;
		this.message = opts.message;
		this.alt = opts.alt;
		this.cta = opts.cta ?? "Confirm";
		this.danger = opts.danger ?? false;
		this.onConfirm = opts.onConfirm;
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title);

		// Preserve paragraph breaks in the message.
		const body = contentEl.createDiv({ cls: "kairos-modal-message" });
		for (const para of this.message.split("\n\n")) {
			body.createEl("p", { text: para });
		}

		const buttons = buttonRow(contentEl);
		new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
		if (this.alt) {
			const alt = this.alt;
			new ButtonComponent(buttons).setButtonText(alt.text).onClick(() => {
				this.close();
				alt.onClick();
			});
		}
		const confirm = new ButtonComponent(buttons).setButtonText(this.cta).onClick(() => {
			this.close();
			this.onConfirm();
		});
		if (this.danger) confirm.setWarning();
		else confirm.setCta();
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * "Why did this change?" (#26). Opened *after* a project or domain has already
 * moved into inactive or archived, so the change never waits on it: Enter or
 * **Save** hands back the trimmed reason, while Esc, **Skip** or an empty Enter
 * just close. Skipping costs nothing — the prompt must never become a toll on
 * changing status.
 */
export class WhyModal extends Modal {
	private value = "";
	private saved = false;
	private readonly title: string;
	private readonly onSave: (why: string) => void;

	constructor(app: App, opts: { title: string; onSave: (why: string) => void }) {
		super(app);
		this.title = opts.title;
		this.onSave = opts.onSave;
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title);

		const setting = new Setting(contentEl).addText((text) => {
			text.setPlaceholder("Add a reason").onChange((v) => (this.value = v));
			text.inputEl.addClass("kairos-modal-input");
			text.inputEl.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter") {
					ev.preventDefault();
					this.save();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		setting.settingEl.addClass("kairos-modal-field");

		const buttons = buttonRow(contentEl);
		new ButtonComponent(buttons).setButtonText("Skip").onClick(() => this.close());
		new ButtonComponent(buttons)
			.setButtonText("Save")
			.setCta()
			.onClick(() => this.save());
	}

	private save() {
		if (this.saved) return;
		this.saved = true;
		const why = this.value.trim();
		this.close();
		if (why !== "") this.onSave(why);
	}

	onClose() {
		this.contentEl.empty();
	}
}
