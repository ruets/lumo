// SPDX-License-Identifier: AGPL-3.0-or-later
import { addDays, compareDates, type LocalDate, startOfWeek, type Weekday } from "./dates.js";
import { isDue, type Schedule } from "./schedule.js";

/** Completions kept per local day (undone and pending ones excluded by the caller). */
export type DailyCounts = Readonly<Record<LocalDate, number>>;

export interface PeriodInput {
	schedule: Schedule;
	/** Completions needed per day for the day to count (`target_per_period`). */
	targetPerDay: number;
	weekStart: Weekday;
	counts: DailyCounts;
}

interface Period {
	outcome: "success" | "fail" | "pending";
	done: number;
	expected: number;
}

/**
 * Splits [from, to] into evaluable periods. Daily, fixed days and monthly: one period per due day.
 * X times a week: one period per week. A period that is still open (today, or the
 * current week) and not yet successful is "pending": it is not a failure.
 */
function evaluate(input: PeriodInput, from: LocalDate, to: LocalDate, today: LocalDate): Period[] {
	const { schedule, targetPerDay, counts, weekStart } = input;
	const periods: Period[] = [];
	const dayOk = (d: LocalDate) => (counts[d] ?? 0) >= targetPerDay;

	if (schedule.type !== "timesPerWeek") {
		for (let d = from; compareDates(d, to) <= 0; d = addDays(d, 1)) {
			if (!isDue(schedule, d)) continue;
			const ok = dayOk(d);
			periods.push({ outcome: ok ? "success" : d === today ? "pending" : "fail", done: ok ? 1 : 0, expected: 1 });
		}
		return periods;
	}

	for (let ws = startOfWeek(from, weekStart); compareDates(ws, to) <= 0; ws = addDays(ws, 7)) {
		const we = addDays(ws, 6);
		let days = 0;
		for (let d = ws; compareDates(d, we) <= 0; d = addDays(d, 1)) {
			if (compareDates(d, from) >= 0 && compareDates(d, to) <= 0 && dayOk(d)) days++;
		}
		const done = Math.min(days, schedule.count);
		if (days >= schedule.count) {
			periods.push({ outcome: "success", done, expected: schedule.count });
		} else if (compareDates(ws, today) <= 0 && compareDates(today, we) <= 0) {
			periods.push({ outcome: "pending", done, expected: schedule.count });
		} else if (compareDates(ws, from) >= 0) {
			// A first week that started partway through does not count as a failure.
			periods.push({ outcome: "fail", done, expected: schedule.count });
		}
	}
	return periods;
}

/** Current and best streak: consecutive successful periods, counting only due days. */
export function computeStreaks(input: PeriodInput & { from: LocalDate; today: LocalDate }): {
	current: number;
	best: number;
} {
	let run = 0;
	let best = 0;
	for (const p of evaluate(input, input.from, input.today, input.today)) {
		if (p.outcome === "success") {
			run++;
			best = Math.max(best, run);
		} else if (p.outcome === "fail") {
			run = 0;
		}
	}
	return { current: run, best };
}

/** Success rate over [from, to]; `rate` is null when nothing was expected. */
export function periodStats(input: PeriodInput & { from: LocalDate; to: LocalDate; today: LocalDate }): {
	done: number;
	expected: number;
	rate: number | null;
} {
	const to = compareDates(input.to, input.today) > 0 ? input.today : input.to;
	let done = 0;
	let expected = 0;
	for (const p of evaluate(input, input.from, to, input.today)) {
		if (p.outcome === "pending") continue;
		done += p.done;
		expected += p.expected;
	}
	return { done, expected, rate: expected === 0 ? null : done / expected };
}
