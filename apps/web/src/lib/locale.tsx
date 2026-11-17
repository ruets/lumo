// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	getLocale,
	isLocalePreference,
	LOCALE_NAMES,
	type Locale,
	type LocalePreference,
	resolveLocale,
	SUPPORTED_LOCALES,
	setLocale,
	t,
} from "@lumo/i18n";
import { Fragment, type ReactNode, useSyncExternalStore } from "react";

const STORAGE_KEY = "lumo.locale";

function readPreference(): LocalePreference {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return isLocalePreference(stored) ? stored : "auto";
	} catch {
		return "auto"; // storage can be unavailable (private mode, blocked site data)
	}
}

const deviceLanguages = () => (navigator.languages?.length ? navigator.languages : [navigator.language]);

let preference = readPreference();
const listeners = new Set<() => void>();

function apply() {
	setLocale(resolveLocale(preference, deviceLanguages()));
	document.documentElement.lang = getLocale();
	for (const l of listeners) l();
}

// Apply before the first render so the UI never flashes in the wrong language.
apply();
window.addEventListener("languagechange", () => preference === "auto" && apply());

export function setPreference(next: LocalePreference): void {
	preference = next;
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		// the choice still applies for this session
	}
	apply();
}

const subscribe = (cb: () => void) => {
	listeners.add(cb);
	return () => listeners.delete(cb);
};

export const usePreference = (): LocalePreference => useSyncExternalStore(subscribe, () => preference);
export const useLocale = (): Locale => useSyncExternalStore(subscribe, getLocale);

/** Remounts its children when the language changes, so every translated string is re-evaluated. */
export function LocaleBoundary({ children }: { children: ReactNode }) {
	return <Fragment key={useLocale()}>{children}</Fragment>;
}

export function LanguageSelect({ className = "" }: { className?: string }) {
	const value = usePreference();
	return (
		<select
			aria-label={t("language.title")}
			value={value}
			onChange={(e) => isLocalePreference(e.target.value) && setPreference(e.target.value)}
			className={`min-h-11 rounded-xl border border-edge bg-bg px-3 font-body text-sm text-soft ${className}`}
		>
			<option value="auto">{t("language.auto")}</option>
			{SUPPORTED_LOCALES.map((l) => (
				<option key={l} value={l}>
					{LOCALE_NAMES[l]}
				</option>
			))}
		</select>
	);
}
