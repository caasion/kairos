// Routines wiring — everything the plugin registers for routines, kept out of
// main.ts: the Routines view and its command, and the "Repeat…" handler that
// task rows reach through `requestRepeat` and block menus through
// `requestRepeatBlock`.

import { Notice, type WorkspaceLeaf } from "obsidian";
import type Kairos from "../main";
import type { Block, Task } from "../types";
import { KAIROS_ROUTINES_VIEW_TYPE, KairosRoutinesView } from "../KairosRoutinesView";
import { RuleModal } from "../ui/routines/RuleModal";
import { blockRepeatDraft, repeatDraft, setRepeatHandler } from "./repeat";
import { addRoutine, type RoutineDraft } from "./routinesWriter";
import { parseRule, ruleSentence, type Rule } from "./rules";

export function registerRoutines(plugin: Kairos): void {
	plugin.registerView(KAIROS_ROUTINES_VIEW_TYPE, (leaf) => new KairosRoutinesView(leaf, plugin));

	plugin.addCommand({
		id: "open-routines-view",
		name: "Open routines view",
		callback: () => void activateRoutinesView(plugin),
	});

	setRepeatHandler((block, task) => openRepeat(plugin, block, task));
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

/** "Repeat…" on `task` in `block`, or on the block itself when `task` is absent. */
function openRepeat(plugin: Kairos, block: Block, task?: Task): void {
	if (task) {
		const where = block.time ? `in ${block.title}` : "on the day's list";
		openRuleModal(plugin, task.text, where, (rule) => repeatDraft(task, block, rule));
		return;
	}
	// Only a timed block repeats as a block; the views offer it on no other.
	const time = block.time;
	if (!time) return;
	openRuleModal(plugin, block.title, "as a block at the same time", (rule) =>
		blockRepeatDraft(block, time, rule),
	);
}

function openRuleModal(
	plugin: Kairos,
	name: string,
	where: string,
	draftFor: (rule: Rule) => RoutineDraft,
): void {
	new RuleModal(plugin.app, {
		title: `Repeat “${name}”`,
		description: `It's added to your routines ${where}. This one stays as the first.`,
		initial: parseRule("daily")!,
		confirm: "Repeat",
		onConfirm: (rule) => {
			const draft = draftFor(rule);
			void plugin.routines.edit((md) => addRoutine(md, draft)).then((ok) => {
				if (ok) new Notice(`“${name}” now repeats ${ruleSentence(rule)}.`);
			});
		},
	}).open();
}
