// SPDX-License-Identifier: AGPL-3.0-or-later
import { addDays, compareDates, type LocalDate, startOfWeek, type Weekday } from "./dates.js";

export interface HeatmapDay {
	date: LocalDate;
	done: number;
	expected: number;
}

export type ProgressPeriod = "week" | "month";

export interface ProgressBar {
	/** First day covered by the bar. */
	from: LocalDate;
	to: LocalDate;
	done: number;
	expected: number;
	/** Current day or week. */
	current: boolean;
	/** Entirely in the future: nothing to show. */
	future: boolean;
}

export interface ProgressSummary {
	period: ProgressPeriod;
	from: LocalDate;
	/** End of the period (may be after today). */
	to: LocalDate;
	bars: ProgressBar[];
	done: number;
	expected: number;
	/** `null` when nothing was expected. Whole percentage, up to today. */
	rate: number | null;
	previousRate: number | null;
	/** Difference in percentage points with the previous period. */
	trend: number | null;
}

const sum = (days: HeatmapDay[], from: LocalDate, to: LocalDate) =>
	days
		.filter((d) => compareDates(d.date, from) >= 0 && compareDates(d.date, to) <= 0)
		.reduce((acc, d) => ({ done: acc.done + d.done, expected: acc.expected + d.expected }), { done: 0, expected: 0 });

const pct = (s: { done: number; expected: number }) =>
	s.expected === 0 ? null : Math.round((100 * s.done) / s.expected);

/**
 * Summarises the `/stats` heatmap for the Progress screen.
 * Week: the current calendar week (future days empty), compared with the previous one.
 * Month: the last 4 rolling weeks (4 bars of 7 days), compared with the 4 before.
 * The heatmap must reach back 56 days before `today`.
 */
export function summarizeProgress(
	heatmap: HeatmapDay[],
	today: LocalDate,
	period: ProgressPeriod,
	weekStart: Weekday = 1,
): ProgressSummary {
	const bars: ProgressBar[] = [];
	let from: LocalDate;
	let to: LocalDate;
	let prevFrom: LocalDate;
	let prevTo: LocalDate;
	if (period === "week") {
		from = startOfWeek(today, weekStart);
		to = addDays(from, 6);
		prevFrom = addDays(from, -7);
		prevTo = addDays(from, -1);
		for (let i = 0; i < 7; i++) {
			const day = addDays(from, i);
			bars.push({
				from: day,
				to: day,
				...sum(heatmap, day, day),
				current: day === today,
				future: compareDates(day, today) > 0,
			});
		}
	} else {
		to = today;
		from = addDays(today, -27);
		prevFrom = addDays(from, -28);
		prevTo = addDays(from, -1);
		for (let i = 0; i < 4; i++) {
			const start = addDays(from, i * 7);
			const end = addDays(start, 6);
			bars.push({ from: start, to: end, ...sum(heatmap, start, end), current: i === 3, future: false });
		}
	}
	const upToToday = compareDates(to, today) > 0 ? today : to;
	const total = sum(heatmap, from, upToToday);
	const rate = pct(total);
	const previousRate = pct(sum(heatmap, prevFrom, prevTo));
	return {
		period,
		from,
		to,
		bars,
		done: total.done,
		expected: total.expected,
		rate,
		previousRate,
		trend: rate !== null && previousRate !== null ? rate - previousRate : null,
	};
}
