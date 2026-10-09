// Routines wiring — everything the plugin registers for routines, kept out of
// main.ts: the Routines view and its command, and the "Repeat…" handler the
// task rows call through `requestRepeat`.

import { Notice, type WorkspaceLeaf } from "obsidian";
import type Kairos from "../main";
import type { Block, Task } from "../types";
import { KAIROS_ROUTINES_VIEW_TYPE, KairosRoutinesView } from "../KairosRoutinesView";
import { RuleModal } from "../ui/routines/RuleModal";
import { isBlockLine, repeatDraft, setRepeatHandler } from "./repeat";
import { addRoutine } from "./routinesWriter";
import { parseRule, ruleSentence } from "./rules";

export function registerRoutines(plugin: Kairos): void {
	plugin.registerView(KAIROS_ROUTINES_VIEW_TYPE, (leaf) => new KairosRoutinesView(leaf, plugin));

	plugin.addCommand({
		id: "open-routines-view",
		name: "Open routines view",
		callback: () => void activateRoutinesView(plugin),
	});

	setRepeatHandler((task, block) => openRepeat(plugin, task, block));
	plugin.register(() => setRepeatHandler(undefined));
}

/** Reveal the Routines view in a main (center) leaf, reusing one if already open. */
export async function activateRoutinesView(plugin: Kairos): Promise<void> {
	const { workspace } = plugin.app;
	let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(KAIROS_ROUTINES_VIEW_TYPE)[0] ?? null;
	if (!leaf) {
		leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: KAIROS_ROUTINES_VIEW_TYPE, active: true });
	}
	void workspace.revealLeaf(leaf);
}

function openRepeat(plugin: Kairos, task: Task, block: Block): void {
	const blockLine = isBlockLine(task, block);
	const name = blockLine ? block.title : task.text;
	const where = blockLine
		? block.time
			? "as a block at the same time"
			: "on the day's list"
		: block.time
			? `in ${block.title}`
			: "on the day's list";
	new RuleModal(plugin.app, {
		title: `Repeat “${name}”`,
		description: `It's added to your routines ${where}. This one stays as the first.`,
		initial: parseRule("daily")!,
		confirm: "Repeat",
		onConfirm: (rule) => {
			const draft = repeatDraft(task, block, rule);
			void plugin.routines.edit((md) => addRoutine(md, draft)).then((ok) => {
				if (ok) new Notice(`“${name}” now repeats ${ruleSentence(rule)}.`);
			});
		},
	}).open();
}
