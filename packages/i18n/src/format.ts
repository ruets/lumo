// SPDX-License-Identifier: AGPL-3.0-or-later
import { getLocale, type Locale } from "./locale.js";
import { t } from "./t.js";

export interface ScheduleLike {
	type: "daily" | "weekly" | "timesPerWeek" | "monthly";
	days?: number[];
	count?: number;
	day?: number;
}

/** Parses `YYYY-MM-DD` as a calendar date (UTC, no time zone shift). */
function parts(date: string): { y: number; m: number; d: number; weekday: number; utc: Date } {
	const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
	const utc = new Date(Date.UTC(y, m - 1, d));
	const js = utc.getUTCDay();
	return { y, m, d, weekday: js === 0 ? 7 : js, utc };
}

const format = (locale: Locale, options: Intl.DateTimeFormatOptions, date: Date) =>
	new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);

/** A date that is a given ISO weekday (1 = Monday), for weekday names. 2024-01-01 is a Monday. */
const weekdayDate = (isoWeekday: number) => new Date(Date.UTC(2024, 0, isoWeekday));

/** "Mon" / "Lun" */
export const weekdayShort = (isoWeekday: number, locale: Locale = getLocale()): string =>
	format(locale, { weekday: "short" }, weekdayDate(isoWeekday)).replace(/\.$/, "");

/** "Monday" / "lundi" */
export const weekdayLong = (isoWeekday: number, locale: Locale = getLocale()): string =>
	format(locale, { weekday: "long" }, weekdayDate(isoWeekday));

/** "Tuesday, November 17" / "mardi 17 novembre" */
export function longDate(date: string, locale: Locale = getLocale()): string {
	const text = format(locale, { weekday: "long", day: "numeric", month: "long" }, parts(date).utc);
	return `${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}`;
}

/** "Nov 17" / "17 nov." */
export const shortDate = (date: string, locale: Locale = getLocale()): string =>
	format(locale, { day: "numeric", month: "short" }, parts(date).utc);

export const dayNumber = (date: string): number => parts(date).d;
export const isoWeekdayOf = (date: string): number => parts(date).weekday;

/** Month name in the given locale ("November" / "novembre"). */
export const monthName = (date: string, locale: Locale = getLocale()): string =>
	format(locale, { month: "long" }, parts(date).utc);

export function scheduleLabel(schedule: ScheduleLike | null | undefined, locale: Locale = getLocale()): string {
	if (!schedule) return t("schedule.task", {}, locale);
	switch (schedule.type) {
		case "daily":
			return t("schedule.daily", {}, locale);
		case "timesPerWeek":
			return t("schedule.timesPerWeek", { count: schedule.count ?? 1 }, locale);
		case "monthly":
			return t("schedule.monthly", { day: schedule.day ?? 1 }, locale);
		case "weekly":
			return t(
				"schedule.weekly",
				{ days: (schedule.days ?? []).map((d) => weekdayLong(d, locale)).join(", ") },
				locale,
			);
	}
}
