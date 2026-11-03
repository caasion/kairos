// The guided tour (chapter 1: plan today). It points at one thing at a time and
// moves on when the person has done it, judged from the index (tourProgress.ts)
// and the workspace, so it works the same whichever way they did it.
//
// State is saved with the plugin data (main.ts), so a tour closed mid-way picks
// up where it left off. Nothing runs while the tour isn't active: no listeners
// beyond two workspace events, no animation frame.

import { Notice, Platform, TFile } from "obsidian";
import type { Unsubscriber } from "svelte/store";
import { KAIROS_VIEW_TYPE } from "../KairosView";
import { todayISO } from "../dayNote";
import type { ISODate } from "../types";
import type Kairos from "../main";
import { intersect } from "./placement";
import type { Rect } from "./placement";
import { TourPopover } from "./popover";
import type { PopoverAction } from "./popover";
import {
	follow,
	locate,
	findExact,
	findNewBlock,
	summarizeDay,
	track,
} from "./tourProgress";
import type { BlockSummary, TrackedBlock } from "./tourProgress";
import { DOCS_URL, STEPS, isStepDone, resumeStep } from "./tourSteps";
import type { AnchorKind, StepContext } from "./tourSteps";
import { WelcomeModal } from "./welcomeModal";
import { ConfirmModal } from "../ui/projects/modals";

/** Minutes after midnight as "09:30". */
function hhmm(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * - `unseen`: a new install; the welcome opens with the first Kairos view.
 * - `announce`: an existing install from before the tour; it gets one notice.
 * - `active`: mid-tour, at `step`.
 * - `done` / `dismissed`: finished or declined; only the command starts it.
 */
export interface TourState {
	status: "unseen" | "announce" | "active" | "done" | "dismissed";
	step: number;
	block?: TrackedBlock;
}

export const NEW_TOUR: TourState = { status: "unseen", step: 0 };

/** The view types that count as "opened Kairos" for the first welcome. */
const KAIROS_VIEW_PREFIX = "kairos-";

/** The ribbon icon main.ts adds; its aria-label is its tooltip. */
const RIBBON_SELECTOR = '.side-dock-ribbon-action[aria-label="Open a Kairos view"]';

const isVisible = (r: Rect | null): r is Rect =>
	!!r && r.width > 0 && r.height > 0;

export class Tour {
	private popover?: TourPopover;
	private frame = 0;
	private unsubDate?: Unsubscriber;
	private unsubDay?: Unsubscriber;
	private watchedDate: ISODate | null = null;
	/** The "N tasks" pill's label while the check step's task is tucked behind it. */
	private tuckedLabel: string | null = null;
	private welcomeOpen = false;
	private indexReady = false;

	/** The date the Day view shows, or null when it's closed. */
	private shownDate: ISODate | null = null;
	/** The shown day's blocks when "make-block" began, to spot the new one. */
	private baseline?: BlockSummary[];
	private baselineDate?: ISODate;
	private current?: BlockSummary;
	private atStepStart?: BlockSummary;
	private noteOpened = false;

	constructor(private readonly plugin: Kairos) {}

	private get state(): TourState {
		return this.plugin.tourState;
	}

	private get step() {
		return STEPS[this.state.step] ?? STEPS[0]!;
	}

	/** Called once from onload. Wires the first-run triggers and resumes. */
	load() {
		const { workspace } = this.plugin.app;
		// After the cold start: before it, the day looks empty, and the first
		// block the index loads would read as one the person just made.
		void this.plugin.indexAdapter.ready.then(() => {
			this.indexReady = true;
			if (this.state.status === "announce") {
				new Notice(
					'Kairos has a guided tour now. Run "Start tour" from the command palette to take it.',
					10000,
				);
				void this.save({ ...this.state, status: "dismissed" });
			}
			if (this.state.status === "active") this.run();
			else this.maybeWelcome();
		});
		this.plugin.registerEvent(
			workspace.on("layout-change", () => {
				this.maybeWelcome();
				if (this.state.status === "active") this.evaluate();
			}),
		);
		this.plugin.registerEvent(
			workspace.on("file-open", (file) => {
				if (this.state.status !== "active" || !(file instanceof TFile)) return;
				const date = this.state.block?.date;
				const day = date
					? this.plugin.indexAdapter.index.snapshot().days.get(date)
					: undefined;
				if (day && file.path === day.path) {
					this.noteOpened = true;
					this.evaluate();
				}
			}),
		);
		this.plugin.register(() => this.stop());
	}

	/** "Start tour": the welcome, then step one, whatever the state was. */
	start() {
		this.stop();
		this.openWelcome();
	}

	private maybeWelcome() {
		if (this.state.status !== "unseen" || this.welcomeOpen) return;
		if (!this.anyKairosViewOpen()) return;
		this.openWelcome();
	}

	private anyKairosViewOpen(): boolean {
		let found = false;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.getViewType().startsWith(KAIROS_VIEW_PREFIX)) found = true;
		});
		return found;
	}

	private openWelcome() {
		this.welcomeOpen = true;
		new WelcomeModal(
			this.plugin.app,
			() => {
				this.welcomeOpen = false;
				void this.save({ status: "active", step: 0 }).then(() => this.run());
			},
			() => {
				this.welcomeOpen = false;
				// "Start tour" mid-tour, then "Not now": carry on where it was.
				if (this.state.status === "active") this.run();
				if (this.state.status === "unseen") {
					void this.save({ ...this.state, status: "dismissed" });
					new Notice('You can take the tour any time: run "Start tour" from the command palette.');
				}
			},
		).open();
	}

	// ── running ──

	private run() {
		this.stop();
		if (!this.indexReady) return; // load() runs it once the index is ready
		const step = resumeStep(this.state.step, !!this.state.block);
		if (step !== this.state.step) void this.save({ ...this.state, step });

		this.popover = new TourPopover(activeDocument);
		this.unsubDate = this.plugin.links.dayDate$.subscribe((date) => {
			this.shownDate = date;
			this.watchDay();
			this.render();
		});
		this.beginStep();
		const tick = () => {
			this.position();
			this.frame = window.requestAnimationFrame(tick);
		};
		this.frame = window.requestAnimationFrame(tick);
	}

	private stop() {
		if (this.frame) window.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.unsubDate?.();
		this.unsubDay?.();
		this.unsubDate = this.unsubDay = undefined;
		this.watchedDate = null;
		this.popover?.destroy();
		this.popover = undefined;
	}

	/** Follow the tracked block's day, or before there is one, the shown day. */
	private watchDay() {
		this.unsubDay?.();
		const date = this.watchTarget();
		// Set before subscribing: the store calls back at once, and that
		// evaluate must see the day as already watched.
		this.watchedDate = date;
		this.unsubDay = date
			? this.plugin.indexAdapter.index.day(date).subscribe(() => this.evaluate())
			: undefined;
		this.evaluate();
	}

	private watchTarget(): ISODate | null {
		return this.state.block?.date ?? this.shownDate;
	}

	/** Reset what a step compares against, then draw it. */
	private beginStep() {
		this.noteOpened = false;
		this.baseline = undefined;
		this.refresh();
		this.atStepStart = this.current;
		this.render();
		this.evaluate();
	}

	/** Re-read the day: spot a new block, or find the tracked one again. */
	private refresh() {
		const days = this.plugin.indexAdapter.index.snapshot().days;
		const tracked = this.state.block;
		if (tracked) {
			const found = locate(tracked, summarizeDay(days.get(tracked.date)));
			this.current = found;
			if (found) {
				const next = follow(tracked, found);
				if (JSON.stringify(next) !== JSON.stringify(tracked)) {
					void this.save({ ...this.state, block: next });
				}
			}
			return;
		}
		this.current = undefined;
		if (this.step.id !== "make-block" || !this.shownDate) return;
		const now = summarizeDay(days.get(this.shownDate));
		if (!this.baseline || this.baselineDate !== this.shownDate) {
			this.baseline = now;
			this.baselineDate = this.shownDate;
			return;
		}
		const made = findNewBlock(this.baseline, now);
		if (made) {
			const block = track(this.shownDate, made);
			this.current = made;
			void this.save({ ...this.state, block });
		}
	}

	/** Move on past every step that's already done. */
	private evaluate() {
		if (this.state.status !== "active" || !this.popover) return;
		this.refresh();
		// A block was just made: from now on watch its day, not the shown one.
		if (this.watchTarget() !== this.watchedDate) return this.watchDay();
		const ctx: StepContext = {
			dayOpen: this.plugin.app.workspace.getLeavesOfType(KAIROS_VIEW_TYPE).length > 0,
			tracked: this.state.block,
			current: this.current,
			atStepStart: this.atStepStart,
			noteOpened: this.noteOpened,
		};
		if (isStepDone(this.step.id, ctx)) this.goTo(this.state.step + 1);
	}

	private goTo(step: number) {
		if (step >= STEPS.length) return this.finish("done");
		void this.save({ ...this.state, step });
		this.beginStep();
	}

	private finish(status: "done" | "dismissed") {
		this.stop();
		void this.save({ status, step: 0 });
	}

	/**
	 * Delete the tour's block, tasks and notes with it, after asking. Only the
	 * block exactly as the tour last saw it (`findExact`); if it can't be found
	 * that way, nothing is removed, since this runs in a real daily note.
	 */
	private removeTrackedBlock() {
		const tracked = this.state.block;
		if (!tracked) return;
		const index = this.plugin.indexAdapter.index;
		const day = index.snapshot().days.get(tracked.date);
		const found = day && findExact(tracked, summarizeDay(day));
		if (!day || !found) {
			new Notice("Couldn't find the tour's block as it was, so nothing was removed.");
			return;
		}
		const tasks = found.tasks.length;
		new ConfirmModal(this.plugin.app, {
			title: "Remove the tour's block?",
			message:
				`This removes "${found.title}" (${hhmm(found.start)}–${hhmm(found.end)}) from ${tracked.date}` +
				(tasks > 0 ? `, with its ${tasks === 1 ? "task" : `${tasks} tasks`}.` : "."),
			cta: "Remove",
			danger: true,
			onConfirm: () => {
				const live = index.snapshot().days.get(tracked.date);
				if (!live || !findExact(tracked, summarizeDay(live))) return;
				index.applyDayEdit(
					live.date,
					live.path,
					live.blocks.filter((b) => b.source.line !== found.line),
				);
			},
		}).open();
	}

	private save(state: TourState) {
		return this.plugin.saveTourState(state);
	}

	// ── drawing ──

	private render() {
		if (!this.popover) return;
		const step = this.step;
		const last = this.state.step === STEPS.length - 1;
		const body = Platform.isMobile && step.bodyMobile ? step.bodyMobile : step.body;

		const actions: PopoverAction[] = [];
		if (step.id === "open-day") {
			actions.push({
				label: "Open it for me",
				onClick: () => void this.plugin.activateView(),
			});
		}
		if (last) {
			if (this.state.block) {
				actions.push({
					label: "Remove what I made",
					onClick: () => {
						this.removeTrackedBlock();
						this.finish("done");
					},
				});
			}
			actions.push({ label: "Finish", cta: true, onClick: () => this.finish("done") });
		} else {
			actions.push({ label: "Skip step", onClick: () => this.goTo(this.state.step + 1) });
		}

		this.popover.render({
			progress: last ? "" : `Step ${this.state.step + 1} of ${STEPS.length - 1}`,
			title: step.title,
			body: this.blockHint(this.tuckedHint(body)),
			link: last ? { text: "Read the getting started guide", href: DOCS_URL } : undefined,
			actions,
			onClose: () => this.finish("dismissed"),
		});
	}

	/** A note when the block the step is about is on another day than shown. */
	private blockHint(body: string): string {
		const date = this.state.block?.date;
		const about = ["rename", "add-task", "check", "open-note"].includes(this.step.id);
		if (!about || !date || date === this.shownDate) return body;
		const when = date === todayISO() ? "today" : date;
		return `${body} Your block is on ${when}.`;
	}

	/** On the check step, says how to show a task the block has tucked away. */
	private tuckedHint(body: string): string {
		if (this.step.id !== "check" || !this.tuckedLabel) return body;
		const show = Platform.isMobile ? "Tap" : "Point at";
		return `The block is too short to show its task. ${show} **${this.tuckedLabel}** to show it, then ${Platform.isMobile ? "tap" : "select"} its checkbox.`;
	}

	private position() {
		this.popover?.position(this.anchorRect(this.step.anchor));
	}

	private anchorRect(kind: AnchorKind): Rect | null {
		if (kind === "none") return null;
		if (kind === "ribbon") {
			const el = activeDocument.querySelector(RIBBON_SELECTOR);
			const r = el?.getBoundingClientRect() ?? null;
			return isVisible(r) ? r : null;
		}

		const leaf = this.plugin.app.workspace.getLeavesOfType(KAIROS_VIEW_TYPE)[0];
		const root = leaf?.view.containerEl;
		if (!root) return null;
		const bounds = root.getBoundingClientRect();
		if (!isVisible(bounds)) return null;
		const clip = (el: Element | null | undefined) => {
			const r = el?.getBoundingClientRect();
			return r && isVisible(r) ? intersect(r, bounds) : null;
		};

		if (kind === "day-canvas") {
			const scroll = root.querySelector(".day-scroll");
			const canvas = clip(root.querySelector('[data-kairos-tour="day-canvas"]'));
			const view = clip(scroll);
			return canvas && view ? intersect(canvas, view) : canvas;
		}
		if (kind === "day-date") return clip(root.querySelector('[data-kairos-tour="day-date"]'));

		if (this.state.block?.date !== this.shownDate) return null;
		const block = this.blockEl(root);
		if (!block) return null;
		if (kind === "block-title") {
			return clip(block.querySelector('[data-kairos-tour="block-title"]') ?? block);
		}
		if (kind === "task-checkbox") return this.checkboxRect(block, clip);
		// block-corner: once the action bar is up, its Add task button…
		const add = this.awakeBar(block)?.querySelector('[aria-label="Add task"]');
		const addRect = add?.getBoundingClientRect() ?? null;
		if (isVisible(addRect)) return addRect;
		// …until then, the top-right zone that wakes it.
		const r = clip(block);
		if (!r) return null;
		const size = Math.min(32, r.width, r.height);
		return { left: r.left + r.width - size, top: r.top, width: size, height: size };
	}

	/**
	 * The block's first checkbox when it shows; while the block is too short to
	 * show its tasks, the "N tasks" pill that does, and the step says so.
	 */
	private checkboxRect(block: HTMLElement, clip: (el: Element | null) => Rect | null): Rect | null {
		const blockRect = clip(block);
		const box = clip(block.querySelector(".k-checkbox"));
		// The block clips what doesn't fit, so a checkbox can exist but be cut off.
		const inside = box && blockRect ? intersect(box, blockRect) : null;
		const shown = box && inside && inside.height >= box.height - 1 ? box : null;
		const more = shown ? null : block.querySelector<HTMLElement>(".tl-more");
		const label = more?.textContent?.trim() || null;
		if (label !== this.tuckedLabel) {
			this.tuckedLabel = label;
			this.render();
		}
		if (shown) return box;
		return clip(more) ?? blockRect;
	}

	/**
	 * The block's action bar while it's up: woken from the corner (in place or
	 * lifted out as a stack), or shown by a tap on touch.
	 */
	private awakeBar(block: HTMLElement): HTMLElement | null {
		if (block.classList.contains("kairos-actions-awake")) {
			const stack = block.ownerDocument.querySelector<HTMLElement>(
				".kairos-action-bar.kairos-action-bar-awake",
			);
			if (stack) return stack;
		}
		const bar = block.querySelector<HTMLElement>(":scope > .kairos-action-bar");
		const win = block.ownerDocument.defaultView;
		return bar && win && Number(win.getComputedStyle(bar).opacity) > 0.5 ? bar : null;
	}

	/** The tracked block's element in the Day view, by line, else by title. */
	private blockEl(root: HTMLElement): HTMLElement | null {
		const want = this.current ?? this.state.block;
		if (!want) return null;
		const byLine = root.querySelector<HTMLElement>(
			`.tl-block[data-block-line="${want.line}"]`,
		);
		if (byLine) return byLine;
		const titles = Array.from(
			root.querySelectorAll<HTMLElement>('[data-kairos-tour="block-title"]'),
		).filter((el) => el.textContent?.trim() === want.title);
		return titles.at(-1)?.closest<HTMLElement>(".tl-block") ?? null;
	}
}
