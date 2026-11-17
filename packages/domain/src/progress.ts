// SPDX-License-Identifier: AGPL-3.0-or-later
import { addDays, compareDates, type LocalDate, startOfWeek, type Weekday } from "./dates.js";

export interface HeatmapDay {
	date: LocalDate;
	done: number;
	expected: number;
}

export type ProgressPeriod = "week" | "month";

export interface ProgressBar {
	/** Premier jour couvert par la barre. */
	from: LocalDate;
	to: LocalDate;
	done: number;
	expected: number;
	/** Jour ou semaine en cours. */
	current: boolean;
	/** Entièrement dans le futur : rien à afficher. */
	future: boolean;
}

export interface ProgressSummary {
	period: ProgressPeriod;
	from: LocalDate;
	/** Fin de la période (peut dépasser aujourd'hui). */
	to: LocalDate;
	bars: ProgressBar[];
	done: number;
	expected: number;
	/** `null` quand rien n'était attendu. Pourcentage entier, jusqu'à aujourd'hui. */
	rate: number | null;
	previousRate: number | null;
	/** Écart en points de pourcentage avec la période précédente. */
	trend: number | null;
}

const sum = (days: HeatmapDay[], from: LocalDate, to: LocalDate) =>
	days
		.filter((d) => compareDates(d.date, from) >= 0 && compareDates(d.date, to) <= 0)
		.reduce((acc, d) => ({ done: acc.done + d.done, expected: acc.expected + d.expected }), { done: 0, expected: 0 });

const pct = (s: { done: number; expected: number }) =>
	s.expected === 0 ? null : Math.round((100 * s.done) / s.expected);

/**
 * Résume la heatmap de `/stats` pour l'écran Progrès.
 * Semaine : la semaine calendaire en cours (jours futurs vides), comparée à la précédente.
 * Mois : les 4 dernières semaines glissantes (4 barres de 7 jours), comparées aux 4 d'avant.
 * Il faut une heatmap qui remonte à 56 jours avant `today`.
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
