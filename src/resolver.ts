import type { Block, ISODate, ResolvedTask } from "./types";

export function resolveBlocks(blocks: Block[], date: ISODate): ResolvedTask[] {
    const tasks: ResolvedTask[] = [];

    for (const block of blocks) {
        const scheduled = block.scheduled;

        // A checkable block surfaces as a task in the flat stream (spec §5:
        // "Tasks and Checkable blocks"). The colocated task is synthesized from
        // the block's own fields — it has no separate storage — and shares the
        // block's source line.
        if (block.status !== undefined) {
            tasks.push({
                source: block.source,
                text: block.title,
                status: block.status,
                ...(block.assoc ? { assoc: block.assoc } : {}),
                ...(block.metadata ? { metadata: block.metadata } : {}),
                owner: block.assoc,
                block,
                date,
                scheduled,
                colocated: true,
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