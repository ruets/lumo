// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "./index.js";

export interface ScheduleLike {
	type: "daily" | "weekly" | "timesPerWeek" | "monthly";
	days?: number[];
	count?: number;
	day?: number;
}

const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
const WEEKDAYS_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;
const MONTHS = [
	"janvier",
	"février",
	"mars",
	"avril",
	"mai",
	"juin",
	"juillet",
	"août",
	"septembre",
	"octobre",
	"novembre",
	"décembre",
] as const;

/** Parse `YYYY-MM-DD` sans passer par un fuseau. */
function parts(date: string): { y: number; m: number; d: number; weekday: number } {
	const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
	const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return { y, m, d, weekday: jsDay === 0 ? 7 : jsDay };
}

export const weekdayShort = (isoWeekday: number): string => WEEKDAYS_SHORT[isoWeekday - 1] ?? "";

/** « Mardi 17 novembre » */
export function longDate(date: string): string {
	const p = parts(date);
	const wd = WEEKDAYS[p.weekday - 1] ?? "";
	return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${p.d} ${MONTHS[p.m - 1]}`;
}

/** « 17 nov. » */
export function shortDate(date: string): string {
	const p = parts(date);
	return `${p.d} ${(MONTHS[p.m - 1] ?? "").slice(0, 3)}.`;
}

export const dayNumber = (date: string): number => parts(date).d;
export const isoWeekdayOf = (date: string): number => parts(date).weekday;
export const monthName = (date: string): string => MONTHS[parts(date).m - 1] ?? "";

export function scheduleLabel(schedule: ScheduleLike | null | undefined): string {
	if (!schedule) return t("schedule.task");
	switch (schedule.type) {
		case "daily":
			return t("schedule.daily");
		case "timesPerWeek":
			return t("schedule.timesPerWeek", { count: schedule.count ?? 1 });
		case "monthly":
			return t("schedule.monthly", { day: schedule.day ?? 1 });
		case "weekly":
			return t("schedule.weekly", { days: (schedule.days ?? []).map((d) => WEEKDAYS[d - 1] ?? "").join(", ") });
	}
}
