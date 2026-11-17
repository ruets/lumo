// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dates calendaires `YYYY-MM-DD` (le « jour local » du foyer). Toute l'arithmétique passe par des
 * dates UTC à minuit : aucun changement d'heure ne peut décaler un jour.
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

/** Jour local d'un instant dans le fuseau du foyer (ex. `Europe/Paris`). */
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

/** Nombre de jours de `a` à `b` (positif si `b` est après `a`). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
	return Math.round((parse(b) - parse(a)) / DAY_MS);
}

export function isoWeekday(date: LocalDate): Weekday {
	const d = new Date(parse(date)).getUTCDay();
	return (d === 0 ? 7 : d) as Weekday;
}

/** Premier jour de la semaine contenant `date`, selon le premier jour choisi par le foyer. */
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
