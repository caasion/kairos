// Routines wiring — everything the plugin registers for routines, kept out of
// main.ts: the Routines view and its command, the "Repeat…" handler that
// task rows reach through `requestRepeat` and block menus through
// `requestRepeatBlock`, and "Save this day as routines".

import { Notice, type WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";
import type Kairos from "../main";
import type { Block, ISODate, Task } from "../types";
import { KAIROS_ROUTINES_VIEW_TYPE, KairosRoutinesView } from "../KairosRoutinesView";
import { RuleModal } from "../ui/routines/RuleModal";
import { SaveDayModal } from "../ui/routines/SaveDayModal";
import { dayLabel } from "./plan";
import { saveDayItems } from "./saveDay";
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

	plugin.addCommand({
		id: "save-day-as-routines",
		name: "Save this day as routines",
		callback: () =>
			void plugin.dayPreparer.currentDay().then((date) => {
				if (date) openSaveDay(plugin, date);
			}),
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

/**
 * "Save this day as routines": offer `date`'s timed blocks and their tasks as
 * routines, repeating on that weekday unless the user picks another rule.
 */
export function openSaveDay(plugin: Kairos, date: ISODate): void {
	const blocks = plugin.indexAdapter.index.snapshot().days.get(date)?.blocks ?? [];
	const items = saveDayItems(blocks, get(plugin.routines.parsed$).routines, date);
	const [y, m, d] = date.split("-").map(Number);
	const weekday = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getDay();
	new SaveDayModal(plugin.app, {
		label: dayLabel(date),
		items,
		initialRule: { kind: "weekly", days: [weekday] },
		onSave: (drafts, rule) => {
			void plugin.routines
				.edit((md) => drafts.reduce(addRoutine, md))
				.then((ok) => {
					if (!ok) return;
					const n = drafts.length;
					new Notice(`Saved ${n} routine${n === 1 ? "" : "s"} that repeat ${ruleSentence(rule)}.`);
				});
		},
	}).open();
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
