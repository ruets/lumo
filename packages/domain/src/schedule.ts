// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import { dayOfMonth, daysInMonth, isoWeekday, type LocalDate } from "./dates.js";

export const scheduleSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("daily") }),
	z.object({
		type: z.literal("weekly"),
		days: z
			.array(z.number().int().min(1).max(7))
			.min(1)
			.refine((days) => new Set(days).size === days.length, "jours en double"),
	}),
	z.object({ type: z.literal("timesPerWeek"), count: z.number().int().min(1).max(7) }),
	z.object({ type: z.literal("monthly"), day: z.number().int().min(1).max(31) }),
]);

export type Schedule = z.infer<typeof scheduleSchema>;

/** L'élément apparaît-il ce jour-là ? (X fois par semaine : tous les jours, le membre choisit.) */
export function isDue(schedule: Schedule, date: LocalDate): boolean {
	switch (schedule.type) {
		case "daily":
		case "timesPerWeek":
			return true;
		case "weekly":
			return schedule.days.includes(isoWeekday(date));
		case "monthly":
			// Un 31 dans un mois de 30 jours tombe le dernier jour du mois.
			return dayOfMonth(date) === Math.min(schedule.day, daysInMonth(date));
	}
}
