import type { Block, ResolvedTask } from "./types";

export function resolveBlocks(blocks: Block[]): ResolvedTask[] {
    const tasks: ResolvedTask[] = [];

    for (const block of blocks) {
        const scheduled = block.scheduled;
        const date = "placeholder";

        // Handle a checkable block
        if (block.task) {
            tasks.push({
                ...block.task,
                owner: block.task.assoc ?? block.assoc,
                block,
                date,
                scheduled,
                colocated: true
            })
        }

        // Handle a block's children
        for (const task of block.tasks) {
            tasks.push({
                ...task,
                owner: task.assoc ?? block.assoc,
                block,
                date,
                scheduled,
                colocated: false,
            })
        }
    }

    return tasks;
}