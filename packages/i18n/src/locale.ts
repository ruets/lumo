// SPDX-License-Identifier: AGPL-3.0-or-later
import { messages } from "./messages.js";

export type Locale = keyof typeof messages;
/** What the user picked: a language, or "auto" to follow the device or browser. */
export type LocalePreference = Locale | "auto";

export const DEFAULT_LOCALE: Locale = "en";
export const SUPPORTED_LOCALES = Object.keys(messages) as Locale[];

/** Language names in their own language, so a user can always find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };

export const isLocale = (value: unknown): value is Locale =>
	typeof value === "string" && (SUPPORTED_LOCALES as string[]).includes(value);

export const isLocalePreference = (value: unknown): value is LocalePreference => value === "auto" || isLocale(value);

/**
 * First supported language among the device's preferred locales, in order (`fr-CA` and `fr_FR` match `fr`).
 * Falls back to English when none matches.
 */
export function negotiateLocale(preferred: readonly string[]): Locale {
	for (const tag of preferred) {
		const language = tag.toLowerCase().split(/[-_]/)[0];
		if (isLocale(language)) return language;
	}
	return DEFAULT_LOCALE;
}

/** Turns a stored preference into the locale to display. */
export const resolveLocale = (preference: LocalePreference, preferred: readonly string[]): Locale =>
	preference === "auto" ? negotiateLocale(preferred) : preference;

let current: Locale = DEFAULT_LOCALE;

export const getLocale = (): Locale => current;
export function setLocale(locale: Locale): void {
	current = locale;
}
