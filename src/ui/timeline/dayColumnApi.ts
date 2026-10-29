// The methods DayColumn.svelte exports, as a plain interface.
//
// typescript-eslint can't see a .svelte component's exports (svelte2tsx isn't
// in the lint loop), so a `bind:this` instance types as `any`. Parents type
// their column refs with this instead; svelte-check keeps it honest, since the
// bound component must satisfy it.

import type { Resolver } from "../../index";
import type {
	Association,
	Block,
	ResolvedTask,
	Task,
	TaskStatus,
	TimeRange,
} from "../../types";

export interface DayColumnApi {
	applyNest(owner: Block, task: Task, destination: Block): void;
	currentBlocksArray(): Block[];
	applyBlockAssoc(block: Block, assoc: Association | null): void;
	applyTaskAssoc(owner: Block, task: Task, assoc: Association | null): void;
	cancelTaskDrag(): void;
	handlePointerMove(event: PointerEvent): boolean;
	handlePointerUp(): { block: Block; time: TimeRange } | null;
	commitLocalMove(block: Block, time: TimeRange): void;
	removeBlockLocally(block: Block): void;
	currentBlocks(): Block[];
	currentPath(): string | null;
	ensurePath(): Promise<string>;
	deleteSelection(): void;
	clearSelection(): void;
	hasSelection(): boolean;
	openNote(): void;
	getUnscheduledBlocks(): Block[];
	getUnscheduledTasks(blockLine: number): ResolvedTask[];
	resolveAssoc(assoc: Association): ReturnType<Resolver>;
	setTaskStatus(owner: Block, task: Task, status: TaskStatus): void;
	setTaskText(owner: Block, task: Task, text: string): void;
	deleteTask(owner: Block, task: Task): void;
	grabTask(owner: Block, task: Task, event: PointerEvent): void;
	editTaskAssoc(owner: Block, task: Task, anchor: DOMRect): void;
	nestTask(owner: Block, task: Task, anchor: DOMRect): void;
	moveToBacklog(owner: Block, task: Task): void;
	navigateAssoc(assoc: Association): void;
}
