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
import { colors } from "@lumo/tokens";
import { getLocales } from "expo-localization";
import { Fragment, type ReactNode, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { createStore, readJson, writeJson } from "./store";
import { font, T } from "./ui";

const KEY = "lumo.locale.v1";
const store = createStore<{ loaded: boolean; preference: LocalePreference; locale: Locale }>({
	loaded: false,
	preference: "auto",
	locale: getLocale(),
});
let loading: Promise<void> | null = null;

const deviceLanguages = () => getLocales().map((l) => l.languageTag);

function apply(preference: LocalePreference, loaded = true) {
	const locale = resolveLocale(preference, deviceLanguages());
	setLocale(locale);
	store.set({ loaded, preference, locale });
}

/** Reads the saved choice and applies it. Call once before the first render of translated text. */
export function loadLocale(): Promise<void> {
	loading ??= readJson<unknown>(KEY, "auto").then((saved) => apply(isLocalePreference(saved) ? saved : "auto"));
	return loading;
}

export async function setPreference(preference: LocalePreference): Promise<void> {
	apply(preference);
	await writeJson(KEY, preference);
}

export const useLocaleState = () => useSyncExternalStore(store.subscribe, store.get);

/** Remounts its children when the language changes, so every translated string is re-evaluated. */
export function LocaleBoundary({ children }: { children: ReactNode }) {
	return <Fragment key={useLocaleState().locale}>{children}</Fragment>;
}

export function LanguagePicker({ showTitle = true }: { showTitle?: boolean }) {
	const { preference } = useLocaleState();
	const options: { id: LocalePreference; label: string }[] = [
		{ id: "auto", label: t("language.auto") },
		...SUPPORTED_LOCALES.map((l) => ({ id: l as LocalePreference, label: LOCALE_NAMES[l] })),
	];
	return (
		<View style={{ gap: 8 }}>
			{showTitle && <T style={{ fontFamily: font.semi, fontSize: 12, color: colors.muted }}>{t("language.title")}</T>}
			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				{options.map((o) => (
					<Pressable
						key={o.id}
						accessibilityRole="button"
						accessibilityState={{ selected: o.id === preference }}
						onPress={() => void setPreference(o.id)}
						style={{
							minHeight: 44,
							paddingHorizontal: 14,
							borderRadius: 12,
							justifyContent: "center",
							backgroundColor: o.id === preference ? colors.primary : colors.surfaceRaised,
						}}
					>
						<T style={{ fontFamily: font.bold, fontSize: 14, color: o.id === preference ? "#fff" : colors.textSoft }}>
							{o.label}
						</T>
					</Pressable>
				))}
			</View>
		</View>
	);
}
