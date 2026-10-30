<script lang="ts">
	// The body of "Save this day as routines": the day's timed blocks, each
	// with its tasks, every one with a checkbox, and when they repeat. What a
	// routine due that day already makes is shown but can't be checked.
	// Unchecking a block unchecks its tasks too, since they'd be homed in a
	// block that isn't a routine; a task can still be checked on its own, and
	// then lands in that block on days the block is there (or Unscheduled).

	import type { Block, Task } from "../../types";
	import type { SaveDayBlock, SaveDayPick } from "../../routines/saveDay";
	import type { Rule } from "../../routines/rules";
	import { formatTimeRange } from "../../parser";
	import RulePicker from "./RulePicker.svelte";

	interface Props {
		items: SaveDayBlock[];
		initialPick: SaveDayPick;
		initialRule: Rule;
		onChange: (pick: SaveDayPick, rule: Rule) => void;
	}

	let { items, initialPick, initialRule, onChange }: Props = $props();
	// svelte-ignore state_referenced_locally
	let blocks = $state(new Set(initialPick.blocks));
	// svelte-ignore state_referenced_locally
	let tasks = $state(new Set(initialPick.tasks));
	// svelte-ignore state_referenced_locally
	let rule = $state(initialRule);

	function report() {
		onChange({ blocks: new Set(blocks), tasks: new Set(tasks) }, rule);
	}

	function toggleBlock(item: SaveDayBlock, on: boolean) {
		const next = new Set(blocks);
		const nextTasks = new Set(tasks);
		if (on) next.add(item.block);
		else next.delete(item.block);
		for (const t of item.tasks) {
			if (t.saved) continue;
			if (on) nextTasks.add(t.task);
			else nextTasks.delete(t.task);
		}
		blocks = next;
		tasks = nextTasks;
		report();
	}

	function toggleTask(task: Task, on: boolean) {
		const next = new Set(tasks);
		if (on) next.add(task);
		else next.delete(task);
		tasks = next;
		report();
	}

	const time = (b: Block) => (b.time ? formatTimeRange(b.time) : "");
</script>

<div class="k-save-day">
	{#if items.length === 0}
		<p class="k-save-day-empty">This day has no blocks with a time to save.</p>
	{:else}
		<ul class="k-save-day-list">
			{#each items as item (item.block.source.line)}
				<li>
					<label class="k-save-day-row" class:is-saved={item.saved}>
						<input
							type="checkbox"
							checked={item.saved || blocks.has(item.block)}
							disabled={item.saved}
							onchange={(e) => toggleBlock(item, e.currentTarget.checked)}
						/>
						<span class="k-save-day-time">{time(item.block)}</span>
						<span class="k-save-day-title">{item.block.title}</span>
						{#if item.saved}<span class="k-save-day-note">Already a routine</span>{/if}
					</label>
					{#if item.tasks.length > 0}
						<ul class="k-save-day-tasks">
							{#each item.tasks as t (t.task.source.line)}
								<li>
									<label class="k-save-day-row" class:is-saved={t.saved}>
										<input
											type="checkbox"
											checked={t.saved || tasks.has(t.task)}
											disabled={t.saved}
											onchange={(e) => toggleTask(t.task, e.currentTarget.checked)}
										/>
										<span class="k-save-day-text">{t.task.text}</span>
										{#if t.saved}<span class="k-save-day-note">Already a routine</span>{/if}
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
		<RulePicker
			initial={initialRule}
			onChange={(next) => {
				rule = next;
				report();
			}}
		/>
	{/if}
</div>

<style>
	.k-save-day {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-3);
	}
	.k-save-day-list,
	.k-save-day-tasks {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.k-save-day-list {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
		max-height: 50vh;
		overflow-y: auto;
	}
	.k-save-day-tasks {
		padding-left: var(--size-4-6);
	}
	.k-save-day-row {
		display: flex;
		align-items: baseline;
		gap: var(--size-4-2);
		font-size: var(--kairos-text-body);
		cursor: pointer;
	}
	.k-save-day-row.is-saved {
		color: var(--text-faint);
		cursor: default;
	}
	.k-save-day-time {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.k-save-day-title {
		font-weight: var(--font-semibold);
	}
	.k-save-day-note {
		margin-left: auto;
		font-size: var(--kairos-text-meta);
		color: var(--text-faint);
	}
	.k-save-day-empty {
		color: var(--text-muted);
		font-size: var(--kairos-text-name);
	}
</style>
