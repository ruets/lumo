// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
	DEFAULT_LOCALE,
	dayNumber,
	errorMessage,
	longDate,
	messages,
	negotiateLocale,
	resolveLocale,
	SUPPORTED_LOCALES,
	scheduleLabel,
	setLocale,
	shortDate,
	t,
	weekdayNarrow,
	weekdayShort,
} from "./index.js";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
	it("every locale has exactly the same keys as English", () => {
		const keys = Object.keys(messages.en).sort();
		for (const locale of SUPPORTED_LOCALES) expect(Object.keys(messages[locale]).sort()).toEqual(keys);
	});

	it("every locale uses the same {placeholders} as English for each key", () => {
		for (const locale of SUPPORTED_LOCALES) {
			for (const [key, text] of Object.entries(messages.en)) {
				const translated = (messages[locale] as Record<string, string>)[key] ?? "";
				expect(placeholders(translated), `${locale}:${key}`).toEqual(placeholders(text));
			}
		}
	});

	it("no translation is empty", () => {
		for (const locale of SUPPORTED_LOCALES) {
			for (const [key, text] of Object.entries(messages[locale])) expect(text.trim(), `${locale}:${key}`).not.toBe("");
		}
	});
});

describe("t", () => {
	it("fills placeholders and leaves a missing one untouched", () => {
		expect(t("today.title", { name: "Léa" }, "en")).toBe("Hello Léa");
		expect(t("today.title", {}, "en")).toBe("Hello {name}");
		expect(t("today.title", { name: "Léa" }, "fr")).toBe("Bonjour Léa");
	});

	it("picks the plural form from count", () => {
		expect(t("today.earned", { count: 1 }, "en")).toBe("+1 coin");
		expect(t("today.earned", { count: 3 }, "en")).toBe("+3 coins");
		expect(t("today.earned", { count: 0 }, "en")).toBe("+0 coins");
		expect(t("today.earned", { count: 1 }, "fr")).toBe("+1 pièce");
		expect(t("today.earned", { count: 0 }, "fr")).toBe("+0 pièce"); // French: 0 is singular
		expect(t("today.earned", { count: 12 }, "fr")).toBe("+12 pièces");
	});

	it("follows the current locale unless one is given", () => {
		setLocale("fr");
		expect(t("nav.today")).toBe("Aujourd’hui");
		setLocale("en");
		expect(t("nav.today")).toBe("Today");
		setLocale(DEFAULT_LOCALE);
	});
});

describe("locale negotiation", () => {
	it("matches the first supported language, ignoring the region", () => {
		expect(negotiateLocale(["fr-CA", "en-US"])).toBe("fr");
		expect(negotiateLocale(["de-DE", "fr_FR"])).toBe("fr");
		expect(negotiateLocale(["en-GB"])).toBe("en");
	});

	it("falls back to English", () => {
		expect(negotiateLocale(["de", "ja"])).toBe("en");
		expect(negotiateLocale([])).toBe("en");
	});

	it("an explicit preference wins over the device", () => {
		expect(resolveLocale("en", ["fr-FR"])).toBe("en");
		expect(resolveLocale("fr", ["en-US"])).toBe("fr");
		expect(resolveLocale("auto", ["fr-FR"])).toBe("fr");
	});
});

describe("dates and schedules", () => {
	it("formats calendar dates with Intl in the chosen locale", () => {
		expect(longDate("2026-11-17", "en")).toBe("Tuesday, November 17");
		expect(longDate("2026-11-17", "fr")).toBe("Mardi 17 novembre");
		expect(shortDate("2026-11-17", "en")).toBe("Nov 17");
		expect(weekdayShort(1, "en")).toBe("Mon");
		expect(weekdayShort(1, "fr")).toBe("lun");
		expect(weekdayNarrow(1, "en")).toBe("M");
		expect(weekdayNarrow(7, "en")).toBe("S");
		expect(weekdayNarrow(1, "fr")).toBe("L");
		expect(dayNumber("2026-11-07")).toBe(7);
	});

	it("describes schedules", () => {
		expect(scheduleLabel({ type: "daily" }, "en")).toBe("Every day");
		expect(scheduleLabel({ type: "timesPerWeek", count: 3 }, "en")).toBe("3 times a week");
		expect(scheduleLabel({ type: "timesPerWeek", count: 1 }, "en")).toBe("1 time a week");
		expect(scheduleLabel({ type: "weekly", days: [1, 3] }, "en")).toBe("Every Monday, Wednesday");
		expect(scheduleLabel({ type: "weekly", days: [1, 3] }, "fr")).toBe("Chaque lundi, mercredi");
		expect(scheduleLabel(null, "fr")).toBe("Ponctuelle");
	});
});

describe("errorMessage", () => {
	it("translates known codes and falls back to the API message otherwise", () => {
		setLocale("fr");
		expect(errorMessage("insufficient_balance")).toBe("Pas assez de pièces.");
		expect(errorMessage("something_new", "Server said no")).toBe("Server said no");
		expect(errorMessage("something_new")).toBe("Une erreur est survenue.");
		setLocale("en");
	});
});
