// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DEFAULT_SERVER } from "../src/config";
import { ServerError, saveServer, verifyServer } from "../src/server";
import { normalizeServerUrl } from "../src/serverUrl";
import { Button, Field, font, T } from "../src/ui";

export default function ServerScreen() {
	const [value, setValue] = useState(DEFAULT_SERVER);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit() {
		setError(null);
		const url = normalizeServerUrl(value);
		if (!url.ok) return setError(t(`server.error.${url.reason}` as const));
		setBusy(true);
		try {
			await verifyServer(url.url);
			await saveServer(url.url); // the router switches to sign-in on its own
		} catch (err) {
			setError(t(`server.error.${err instanceof ServerError ? err.code : "unreachable"}` as const));
		} finally {
			setBusy(false);
		}
	}

	return (
		<SafeAreaView
			style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: spacing.lg }}
		>
			<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
				<View style={{ backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: 14 }}>
					<T style={{ fontFamily: font.displayBold, fontSize: 28 }}>{t("app.name")}</T>
					<T style={{ fontFamily: font.bold, fontSize: 16 }}>{t("server.title")}</T>
					<T style={{ fontSize: 14, color: colors.muted }}>{t("server.hint")}</T>
					<Field
						label={t("server.label")}
						value={value}
						onChangeText={setValue}
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
						placeholder="lumo.exemple.fr"
						onSubmitEditing={() => void submit()}
					/>
					{error && (
						<T accessibilityRole="alert" style={{ color: colors.danger, fontFamily: font.semi }}>
							{error}
						</T>
					)}
					<Button
						label={busy ? t("server.checking") : t("server.continue")}
						disabled={busy}
						onPress={() => void submit()}
					/>
				</View>
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}
