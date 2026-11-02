<script lang="ts">
	// The body of "Save this day as routines": the day's timed blocks, each
	// with its tasks and its own rule, and a "Repeat all" that sets every rule
	// at once. Each row says what saving it does to the routines file: a
	// routine due that day is shown and left alone (or, when the day has it at
	// another time, offered to move); a block matching a routine on other days
	// adds this day's rule to it; a block where a missing routine should be can
	// replace it. Unchecking a block unchecks its tasks; a task can still be
	// checked on its own, and then lands in that block on days the block is
	// there (or Unscheduled).

	import type { Block, Task } from "../../types";
	import {
		isLocked,
		overlapsOf,
		repeatAll,
		ruleOf,
		type SaveDayBlock,
		type SaveDayPick,
	} from "../../routines/saveDay";
	import type { Routine } from "../../routines/routinesFile";
	import { ruleKey, ruleSentence, ruleText, type Rule } from "../../routines/rules";
	import { formatTimeRange } from "../../parser";
	import RulePicker from "./RulePicker.svelte";

	interface Props {
		items: SaveDayBlock[];
		routines: Routine[];
		initialPick: SaveDayPick;
		initialRule: Rule;
		onChange: (pick: SaveDayPick) => void;
	}

	let { items, routines, initialPick, initialRule, onChange }: Props = $props();
	// svelte-ignore state_referenced_locally
	let pick = $state<SaveDayPick>({ ...initialPick });
	// svelte-ignore state_referenced_locally
	let allRule = $state(initialRule);
	/** The row whose rule picker is open ("all" for Repeat all). */
	let open = $state<Block | "all" | undefined>(undefined);

	function set(next: Partial<SaveDayPick>) {
		pick = { ...pick, ...next };
		onChange(pick);
	}

	function toggleBlock(item: SaveDayBlock, on: boolean) {
		const blocks = new Set(pick.blocks);
		const tasks = new Set(pick.tasks);
		if (on) blocks.add(item.block);
		else blocks.delete(item.block);
		// A routine's own tasks stay as they are when only its time is in question.
		if (!item.routine) {
			for (const t of item.tasks) {
				if (t.saved) continue;
				if (on) tasks.add(t.task);
				else tasks.delete(t.task);
			}
		}
		set({ blocks, tasks });
	}

	function toggleTask(task: Task, on: boolean) {
		const tasks = new Set(pick.tasks);
		if (on) tasks.add(task);
		else tasks.delete(task);
		set({ tasks });
	}

	function setRule(item: SaveDayBlock, rule: Rule) {
		const rules = new Map(pick.rules);
		rules.set(item.block, rule);
		set({ rules });
	}

	function setAll(rule: Rule) {
		allRule = rule;
		set({ rules: repeatAll(items, pick, rule) });
	}

	function toggleReplace(item: SaveDayBlock, on: boolean) {
		const replace = new Set(pick.replace);
		const rules = new Map(pick.rules);
		if (on) {
			replace.add(item.block);
			// Replacing keeps the routine's days; the row's rule starts on them.
			if (item.replaces) rules.set(item.block, item.replaces.rule);
		} else {
			replace.delete(item.block);
			rules.set(item.block, allRule);
		}
		set({ replace, rules });
	}

	const time = (b: Block) => (b.time ? formatTimeRange(b.time) : "");

	/** What saving the row does to an existing routine, in a few words. */
	function extendNote(item: SaveDayBlock, rule: Rule): string {
		const r = item.extends;
		if (!r) return "";
		if (ruleKey(rule) === ruleKey(r.rule)) return `Your ${r.title} routine, unchanged`;
		const was = r.rule.kind === "weekly" ? r.rule.days : [];
		const now = rule.kind === "weekly" ? rule.days : [];
		const added = now.filter((d) => !was.includes(d));
		const removed = rule.kind === "weekly" ? was.filter((d) => !now.includes(d)) : was;
		if (added.length > 0 && removed.length === 0) {
			return `Adds ${ruleText({ kind: "weekly", days: added })} to your ${r.title} routine`;
		}
		return `Changes your ${r.title} routine`;
	}

	function overlapNote(item: SaveDayBlock, rule: Rule): string {
		const found = overlapsOf(item, rule, routines, pick.replace.has(item.block));
		return found
			.map((o) => `Overlaps ${o.routine.title} ${ruleSentence({ kind: "weekly", days: o.days })}`)
			.join(" · ");
	}
</script>

<div class="k-save-day">
	{#if items.length === 0}
		<p class="k-save-day-empty">This day has no blocks with a time to save.</p>
	{:else}
		<div class="k-save-day-all">
			<span class="k-save-day-muted">Repeat all on</span>
			<button
				class="k-save-day-rule"
				aria-expanded={open === "all"}
				onclick={() => (open = open === "all" ? undefined : "all")}>{ruleText(allRule)}</button
			>
			<span class="k-save-day-note">sets every row below</span>
		</div>
		{#if open === "all"}
			<div class="k-save-day-picker">
				<RulePicker initial={allRule} onChange={setAll} />
			</div>
		{/if}
		<ul class="k-save-day-list">
			{#each items as item (item.block.source.line)}
				{@const rule = ruleOf(item, pick)}
				{@const locked = isLocked(item)}
				{@const checked = pick.blocks.has(item.block)}
				{@const overlaps = !locked && checked ? overlapNote(item, rule) : ""}
				<li>
					<div class="k-save-day-row" class:is-saved={locked && !item.moved}>
						<label class="k-save-day-check">
							<input
								type="checkbox"
								checked={(locked && !item.moved) || checked}
								disabled={locked && !item.moved}
								onchange={(e) => toggleBlock(item, e.currentTarget.checked)}
							/>
							<span class="k-save-day-time">{time(item.block)}</span>
							<span class="k-save-day-title">{item.block.title}</span>
						</label>
						{#if locked}
							<span class="k-save-day-rule-text">Routine · {ruleText(rule)}</span>
						{:else}
							<button
								class="k-save-day-rule"
								aria-expanded={open === item.block}
								onclick={() => (open = open === item.block ? undefined : item.block)}
								>{ruleText(rule)}</button
							>
						{/if}
					</div>
					<div class="k-save-day-notes">
						{#if item.routine && item.moved}
							<span>Routine at {formatTimeRange(item.routine.time)} · check to move it to this time</span>
						{/if}
						{#if item.extends && checked}<span>{extendNote(item, rule)}</span>{/if}
						{#if item.replaces && checked}
							<label class="k-save-day-replace">
								<input
									type="checkbox"
									checked={pick.replace.has(item.block)}
									onchange={(e) => toggleReplace(item, e.currentTarget.checked)}
								/>
								<span>Replace {item.replaces.title} ({formatTimeRange(item.replaces.time)}) instead</span>
							</label>
						{/if}
						{#each item.alsoAt as other (other.line)}
							<span>{other.title} is also a routine at {formatTimeRange(other.time)}, {ruleSentence(other.rule)}</span>
						{/each}
						{#if overlaps}<span class="k-save-day-warn">{overlaps}</span>{/if}
					</div>
					{#if open === item.block && !locked}
						<div class="k-save-day-picker">
							{#key ruleKey(allRule)}
								<RulePicker initial={rule} onChange={(next) => setRule(item, next)} />
							{/key}
						</div>
					{/if}
					{#if item.tasks.length > 0}
						<ul class="k-save-day-tasks">
							{#each item.tasks as t (t.task.source.line)}
								<li>
									<label class="k-save-day-row k-save-day-check" class:is-saved={t.saved}>
										<input
											type="checkbox"
											checked={t.saved || pick.tasks.has(t.task)}
											disabled={t.saved}
											onchange={(e) => toggleTask(t.task, e.currentTarget.checked)}
										/>
										<span class="k-save-day-text">{t.task.text}</span>
										{#if t.saved}
											<span class="k-save-day-note">Already a routine</span>
										{:else if t.extends}
											<span class="k-save-day-note">Adds days to its routine ({ruleText(t.extends.rule)})</span>
										{/if}
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.k-save-day {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-3);
	}
	.k-save-day-all {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		font-size: var(--kairos-text-body);
	}
	.k-save-day-picker {
		padding: var(--size-4-2) 0 var(--size-4-2) var(--size-4-6);
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
		max-height: 55vh;
		overflow-y: auto;
		border-top: 1px solid var(--background-modifier-border);
		padding-top: var(--size-4-2);
	}
	.k-save-day-tasks {
		padding-left: var(--size-4-6);
	}
	.k-save-day-row {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		font-size: var(--kairos-text-body);
	}
	.k-save-day-check {
		display: flex;
		align-items: baseline;
		gap: var(--size-4-2);
		flex: 1;
		min-width: 0;
		cursor: pointer;
	}
	.k-save-day-row.is-saved {
		color: var(--text-faint);
	}
	.k-save-day-row.is-saved .k-save-day-check {
		cursor: default;
	}
	.k-save-day-time {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.k-save-day-title {
		font-weight: var(--font-semibold);
	}
	.k-save-day-rule {
		font-size: var(--kairos-text-label);
	}
	.k-save-day-rule-text {
		font-size: var(--kairos-text-label);
		color: var(--text-faint);
	}
	.k-save-day-notes {
		display: flex;
		flex-direction: column;
		padding-left: var(--size-4-6);
		font-size: var(--kairos-text-meta);
		color: var(--text-muted);
	}
	.k-save-day-notes:empty {
		display: none;
	}
	.k-save-day-replace {
		display: flex;
		align-items: center;
		gap: var(--size-4-1);
		cursor: pointer;
	}
	.k-save-day-warn {
		color: var(--color-orange);
	}
	.k-save-day-note {
		margin-left: auto;
		font-size: var(--kairos-text-meta);
		color: var(--text-faint);
	}
	.k-save-day-muted {
		color: var(--text-muted);
	}
	.k-save-day-empty {
		color: var(--text-muted);
		font-size: var(--kairos-text-name);
	}
</style>
