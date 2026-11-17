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
			.refine((days) => new Set(days).size === days.length, "duplicate days"),
	}),
	z.object({ type: z.literal("timesPerWeek"), count: z.number().int().min(1).max(7) }),
	z.object({ type: z.literal("monthly"), day: z.number().int().min(1).max(31) }),
]);

export type Schedule = z.infer<typeof scheduleSchema>;

/** Does the item show up that day? (X times a week: every day, the member chooses.) */
export function isDue(schedule: Schedule, date: LocalDate): boolean {
	switch (schedule.type) {
		case "daily":
		case "timesPerWeek":
			return true;
		case "weekly":
			return schedule.days.includes(isoWeekday(date));
		case "monthly":
			// A 31st in a 30-day month falls on the last day of the month.
			return dayOfMonth(date) === Math.min(schedule.day, daysInMonth(date));
	}
}
