<script lang="ts">
	// Pick when a routine repeats: Daily, Weekdays, Weekends, any set of
	// weekdays, or a day of the month. It holds the choice in progress and
	// reports every change; the host (a modal) decides when a choice is final.

	import { ruleKey, ruleText, weekdayName, type Rule } from "../../routines/rules";

	interface Props {
		initial: Rule;
		onChange: (rule: Rule) => void;
	}

	let { initial, onChange }: Props = $props();
	// svelte-ignore state_referenced_locally
	let value = $state<Rule>(initial);

	function choose(rule: Rule) {
		value = rule;
		onChange(rule);
	}

	const DAILY: Rule = { kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6] };
	const WEEKDAYS: Rule = { kind: "weekly", days: [1, 2, 3, 4, 5] };
	const WEEKENDS: Rule = { kind: "weekly", days: [0, 6] };
	// Monday first, as the rule text reads.
	const WEEK = [1, 2, 3, 4, 5, 6, 0];

	const monthly = $derived(value.kind === "monthly");
	const days = $derived(value.kind === "weekly" ? value.days : []);
	// The day of month the Monthly option starts on, remembered across toggles.
	// svelte-ignore state_referenced_locally
	let monthDay = $state(initial.kind === "monthly" ? initial.day : 1);

	function is(rule: Rule): boolean {
		return ruleKey(rule) === ruleKey(value);
	}

	function toggleDay(day: number) {
		if (days.includes(day) && days.length === 1) return; // a rule needs at least one day
		const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
		choose({ kind: "weekly", days: next.sort((a, b) => a - b) });
	}

	function setMonthDay(raw: string) {
		const day = Math.round(Number(raw));
		if (!Number.isFinite(day) || day < 1 || day > 31) return;
		monthDay = day;
		choose({ kind: "monthly", day });
	}
</script>

<div class="k-rule-picker">
	<div class="k-rule-presets">
		<button class="k-rule-chip" class:is-active={is(DAILY)} onclick={() => choose(DAILY)}>Daily</button>
		<button class="k-rule-chip" class:is-active={is(WEEKDAYS)} onclick={() => choose(WEEKDAYS)}>Weekdays</button>
		<button class="k-rule-chip" class:is-active={is(WEEKENDS)} onclick={() => choose(WEEKENDS)}>Weekends</button>
		<button
			class="k-rule-chip"
			class:is-active={monthly}
			onclick={() => choose({ kind: "monthly", day: monthDay })}>Monthly</button
		>
	</div>

	{#if monthly}
		<label class="k-rule-month">
			<span>On day</span>
			<input
				type="number"
				min="1"
				max="31"
				value={monthDay}
				oninput={(e) => setMonthDay(e.currentTarget.value)}
			/>
			<span class="k-rule-hint">of each month</span>
		</label>
	{:else}
		<div class="k-rule-days" role="group" aria-label="Days of the week">
			{#each WEEK as day (day)}
				<button
					class="k-rule-day"
					class:is-active={days.includes(day)}
					aria-pressed={days.includes(day)}
					onclick={() => toggleDay(day)}
				>{weekdayName(day)}</button>
			{/each}
		</div>
	{/if}

	<div class="k-rule-summary">Repeats: <strong>{ruleText(value)}</strong></div>
</div>

<style>
	.k-rule-picker {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.k-rule-presets,
	.k-rule-days {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.k-rule-chip,
	.k-rule-day {
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 12px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary-alt);
		color: var(--text-muted);
		box-shadow: none;
		cursor: pointer;
	}
	.k-rule-day {
		min-width: 40px;
	}
	.k-rule-chip:hover,
	.k-rule-day:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}
	.k-rule-chip.is-active,
	.k-rule-day.is-active {
		color: var(--text-on-accent);
		background: var(--interactive-accent);
		border-color: var(--interactive-accent);
	}
	.k-rule-month {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	.k-rule-month input {
		width: 64px;
	}
	.k-rule-hint {
		color: var(--text-muted);
	}
	.k-rule-summary {
		font-size: 12px;
		color: var(--text-muted);
	}
</style>
