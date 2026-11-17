// SPDX-License-Identifier: AGPL-3.0-or-later
import { getLocale, type Locale } from "./locale.js";
import { type MessageKey, messages } from "./messages.js";

type Params = Record<string, string | number>;

function pluralRule(locale: Locale, count: number): string {
	try {
		return new Intl.PluralRules(locale).select(count);
	} catch {
		return count === 1 ? "one" : "other";
	}
}

/**
 * Translates `key`, filling `{placeholders}` from `params`. When `params.count` is a number, the plural form
 * (`key_one`, `key_other`…) is used if the dictionary has one. A missing key in a locale falls back to English.
 */
export function t(key: MessageKey, params: Params = {}, locale: Locale = getLocale()): string {
	const dictionary = messages[locale] as Record<string, string>;
	const source = messages.en as Record<string, string>;
	const pick = (dict: Record<string, string>) => {
		if (typeof params.count === "number") {
			const plural = dict[`${key}_${pluralRule(locale, params.count)}`] ?? dict[`${key}_other`];
			if (plural !== undefined) return plural;
		}
		return dict[key];
	};
	const template = pick(dictionary) ?? pick(source) ?? key;
	return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** Readable message for an API error `code`; `fallback` (the API's English message) when there is none. */
export function errorMessage(code: string, fallback?: string): string {
	const key = `errors.${code}`;
	return key in messages.en ? t(key as MessageKey) : (fallback ?? t("errors.unknown"));
}
