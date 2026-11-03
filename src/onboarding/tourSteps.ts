// Chapter 1 of the guided tour: plan today. Each step moves on when the person
// actually does the thing it asks, not when they select Next; doing a gesture
// once is what teaches it. The copy and the "is this step done?" rules live
// here, apart from the DOM, so the rules are unit-tested.
//
// Pure: no Obsidian imports.

import { statusChanged } from "./tourProgress";
import type { BlockSummary, TrackedBlock } from "./tourProgress";

export type StepId =
	| "open-day"
	| "make-block"
	| "rename"
	| "add-task"
	| "check"
	| "open-note"
	| "finish";

/** What a step's popover points at. */
export type AnchorKind =
	| "ribbon"
	| "day-canvas"
	| "block-title"
	| "block-corner"
	| "task-checkbox"
	| "day-date"
	| "none";

export interface TourStep {
	id: StepId;
	title: string;
	body: string;
	/** The copy on a phone or tablet, where there's no hover or right-click. */
	bodyMobile?: string;
	anchor: AnchorKind;
}

export const DOCS_URL =
	"https://github.com/caasion/kairos/blob/main/docs/getting-started.md";

export const STEPS: TourStep[] = [
	{
		id: "open-day",
		title: "Open the Day view",
		body: "Everything starts at the hourglass in the ribbon. Select it, then select **Day**.",
		bodyMobile: "Open the command palette and run **Open day view**, or select **Open it for me**.",
		anchor: "ribbon",
	},
	{
		id: "make-block",
		title: "Make a block",
		body: "Press on empty time and drag down. A block is a span of your day, like 09:30 - 11:00 Deep work. A plain click won't make one.",
		bodyMobile: "Press and hold empty time, then drag down to make a block. A block is a span of your day, like 09:30 - 11:00 Deep work.",
		anchor: "day-canvas",
	},
	{
		id: "rename",
		title: "Name it",
		body: "Select the block's title and type what you'll do. **Enter** saves. You can select its time the same way to type an exact one.",
		bodyMobile: "Tap the block's title to select it, then tap again and type what you'll do. Its time works the same way, to type an exact one.",
		anchor: "block-title",
	},
	{
		id: "add-task",
		title: "Add a task",
		body: "Point at the block's top-right corner to bring up its buttons, then select **Add task**. Right-clicking the block works too. Tasks are the work; they always live inside a block.",
		bodyMobile: "Tap the block to select it, then tap **Add task** on its action bar. **⋯** at the end of the bar has everything else. Tasks are the work; they always live inside a block.",
		anchor: "block-corner",
	},
	{
		id: "check",
		title: "Check it off",
		body: "Select the checkbox. Each click moves it along: open, half-done, done. Press and hold it to cancel the task.",
		bodyMobile: "Tap the checkbox. Each tap moves it along: open, half-done, done. Press and hold it to cancel the task.",
		anchor: "task-checkbox",
	},
	{
		id: "open-note",
		title: "See the markdown",
		body: "Ctrl/Cmd+click the date to open the day's note. Your plan is plain markdown under its schedule heading, and you can edit it by hand.",
		bodyMobile: "Tap **⋯** beside the date and select **Open daily note**. Your plan is plain markdown under its schedule heading, and you can edit it by hand.",
		anchor: "day-date",
	},
	{
		id: "finish",
		title: "That's the whole idea",
		body: "Time belongs to blocks; work belongs to tasks. When you want more, drag tasks between days in the **Grid**, name projects as they come up, and add routines.",
		bodyMobile: "Time belongs to blocks; work belongs to tasks. To move a block, tap it and drag the round handle on its side, or press and hold its title. When you want more, press and hold a task to move it to another day in the **Grid**, name projects as they come up, and make a block repeat with **⋯ → Repeat…**.",
		anchor: "none",
	},
];

/** What the tour knows about the person's progress right now. */
export interface StepContext {
	/** A Day view is open. */
	dayOpen: boolean;
	/** The block made in "make-block", once there is one. */
	tracked?: TrackedBlock;
	/** The tracked block as the index has it now, when it can be found. */
	current?: BlockSummary;
	/** The tracked block as it was when the current step began. */
	atStepStart?: BlockSummary;
	/** The tracked block's note was opened during this step. */
	noteOpened: boolean;
}

/** Whether the person has done what `id` asks. */
export function isStepDone(id: StepId, ctx: StepContext): boolean {
	const { tracked, current, atStepStart } = ctx;
	switch (id) {
		case "open-day":
			return ctx.dayOpen;
		case "make-block":
			return tracked !== undefined;
		case "rename":
			return !!tracked && !!current && current.title !== tracked.createdTitle;
		case "add-task":
			return (
				!!current &&
				!!atStepStart &&
				current.tasks.length > atStepStart.tasks.length
			);
		case "check":
			return (
				!!current &&
				!!atStepStart &&
				statusChanged(atStepStart.tasks, current.tasks)
			);
		case "open-note":
			return ctx.noteOpened;
		case "finish":
			return false;
	}
}

/**
 * The step to resume at after a restart. Steps after "make-block" are about the
 * tracked block, so without one (it was deleted, or the state predates it) the
 * tour goes back to making one. The last step needs no block, so it stays.
 */
export function resumeStep(step: number, hasTracked: boolean): number {
	const last = STEPS.length - 1;
	const clamped = Math.max(0, Math.min(step, last));
	const makeBlock = STEPS.findIndex((s) => s.id === "make-block");
	if (clamped > makeBlock && clamped < last && !hasTracked) return makeBlock;
	return clamped;
}
