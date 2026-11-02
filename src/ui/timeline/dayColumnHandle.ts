// What WeekView calls on each DayColumn through `bind:this`. ESLint's Svelte
// parser can't resolve a component's instance type, so typing `columns` as
// `DayColumn` leaves every call `any`. This names the exported surface
// explicitly; DayColumn.svelte's exports must stay assignable to it.

import type { ResolvedAssociation } from "../../association";
import type {
	Association,
	Block,
	ResolvedTask,
	Task,
	TaskStatus,
	TimeRange,
} from "../../types";

export interface DayColumnHandle {
	addUnscheduledTask(): Promise<void>;
	applyNest(owner: Block, task: Task, destination: Block): void;
	applyBlockAssoc(block: Block, assoc: Association | null): void;
	applyTaskAssoc(owner: Block, task: Task, assoc: Association | null): void;
	cancelTaskDrag(): void;
	handlePointerMove(event: PointerEvent): boolean;
	handlePointerUp(): { block: Block; time: TimeRange } | null;
	commitLocalMove(block: Block, time: TimeRange): void;
	removeBlockLocally(block: Block): void;
	currentBlocks(): Block[];
	currentBlocksArray(): Block[];
	currentPath(): string | null;
	ensurePath(): Promise<string>;
	deleteSelection(): void;
	clearSelection(): void;
	hasSelection(): boolean;
	openNote(): void;
	getUnscheduledBlocks(): Block[];
	getUnscheduledTasks(blockLine: number): ResolvedTask[];
	resolveAssoc(assoc: Association): ResolvedAssociation;
	setTaskStatus(owner: Block, task: Task, status: TaskStatus): void;
	setTaskText(owner: Block, task: Task, text: string): void;
	deleteTask(owner: Block, task: Task): void;
	grabTask(owner: Block, task: Task, event: PointerEvent): void;
	editTaskAssoc(owner: Block, task: Task, anchor: DOMRect): void;
	nestTask(owner: Block, task: Task, anchor: DOMRect): void;
	moveToBacklog(owner: Block, task: Task): void;
	navigateAssoc(assoc: Association): void;
}
