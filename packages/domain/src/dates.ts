// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Calendar dates `YYYY-MM-DD` (the household's "local day"). All arithmetic goes through
 * UTC midnight dates: no daylight-saving change can shift a day.
 */

export type LocalDate = string;
/** 1 = lundi … 7 = dimanche (ISO). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const DAY_MS = 86_400_000;
const FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(date: LocalDate): number {
	const m = FORMAT.exec(date);
	if (!m) throw new Error(`Date invalide : ${date}`);
	const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	if (format(ms) !== date) throw new Error(`Date invalide : ${date}`);
	return ms;
}

function format(ms: number): LocalDate {
	return new Date(ms).toISOString().slice(0, 10);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Local day of an instant in the household's time zone (e.g. `Europe/Paris`). */
export function localDate(instant: Date, timeZone: string): LocalDate {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
		formatters.set(timeZone, f);
	}
	const parts = Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(date: LocalDate, days: number): LocalDate {
	return format(parse(date) + days * DAY_MS);
}

/** Number of days from `a` to `b` (positive if `b` is after `a`). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
	return Math.round((parse(b) - parse(a)) / DAY_MS);
}

export function isoWeekday(date: LocalDate): Weekday {
	const d = new Date(parse(date)).getUTCDay();
	return (d === 0 ? 7 : d) as Weekday;
}

/** First day of the week containing `date`, according to the household's chosen first day. */
export function startOfWeek(date: LocalDate, weekStart: Weekday): LocalDate {
	return addDays(date, -((isoWeekday(date) - weekStart + 7) % 7));
}

export function daysInMonth(date: LocalDate): number {
	const ms = parse(date);
	const d = new Date(ms);
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function compareDates(a: LocalDate, b: LocalDate): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function dayOfMonth(date: LocalDate): number {
	return Number(date.slice(8, 10));
}
