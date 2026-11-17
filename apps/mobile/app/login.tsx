// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError, type TokenPair } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { makeRedirectUri, useAuthRequest, useAutoDiscovery } from "expo-auth-session";
import { randomUUID } from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { OIDC_CLIENT_ID, OIDC_ISSUER } from "../src/config";
import { describeError, keys, useAuthConfig } from "../src/hooks";
import { api, saveTokens } from "../src/session";
import { Button, Field, font, T } from "../src/ui";

WebBrowser.maybeCompleteAuthSession();

export default function Login() {
	const qc = useQueryClient();
	const config = useAuthConfig();
	const [error, setError] = useState<string | null>(null);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [householdName, setHouseholdName] = useState("");

	const done = () => qc.invalidateQueries({ queryKey: keys.me });

	// Authorization Code + PKCE conduit par expo-auth-session ; l'API échange ensuite le code.
	const discovery = useAutoDiscovery(OIDC_ISSUER);
	const nonce = useMemo(() => randomUUID(), []);
	const redirectUri = makeRedirectUri({ scheme: "lumo", path: "auth" });
	const [request, response, promptAsync] = useAuthRequest(
		{
			clientId: OIDC_CLIENT_ID,
			redirectUri,
			scopes: ["openid", "profile", "email"],
			usePKCE: true,
			extraParams: { nonce },
		},
		discovery,
	);

	useEffect(() => {
		if (response?.type !== "success" || !request?.codeVerifier) return;
		api
			.exchangeMobile({
				code: response.params.code ?? "",
				codeVerifier: request.codeVerifier,
				redirectUri,
				nonce,
				...(response.params.state ? { state: response.params.state } : {}),
			})
			.then(async (tokens) => {
				await saveTokens(tokens);
				await qc.invalidateQueries({ queryKey: keys.me });
			})
			.catch((err: unknown) => setError(describeError(err)));
	}, [response, request, redirectUri, nonce, qc]);

	async function submit() {
		setError(null);
		try {
			const tokens = (
				config.data?.setupRequired
					? await api.setup({ householdName, displayName, username, password, client: "mobile" })
					: await api.loginLocal({ username, password, client: "mobile" })
			) as TokenPair;
			await saveTokens(tokens);
			await done();
		} catch (err) {
			setError(err instanceof ApiError ? describeError(err) : t("auth.error"));
		}
	}

	return (
		<SafeAreaView
			style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: spacing.lg }}
		>
			<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
				<View style={{ backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: 14 }}>
					<T style={{ fontFamily: font.displayBold, fontSize: 32 }}>{t("app.name")}</T>
					{error && <T style={{ color: colors.danger, fontFamily: font.semi }}>{error}</T>}
					{config.isPending && <ActivityIndicator color={colors.primaryLink} />}
					{config.data?.oidc && OIDC_ISSUER !== "" && !config.data.setupRequired && (
						<Button label={t("auth.oidc")} disabled={!request} onPress={() => void promptAsync()} />
					)}
					{config.data?.local && (
						<>
							{config.data.setupRequired && (
								<>
									<Field label="Nom du foyer" value={householdName} onChangeText={setHouseholdName} />
									<Field label="Ton prénom" value={displayName} onChangeText={setDisplayName} />
								</>
							)}
							<Field
								label={t("auth.username")}
								autoCapitalize="none"
								autoComplete="username"
								value={username}
								onChangeText={setUsername}
							/>
							<Field
								label={t("auth.password")}
								secureTextEntry
								autoComplete="password"
								value={password}
								onChangeText={setPassword}
							/>
							<Button label={t("auth.submit")} onPress={() => void submit()} />
						</>
					)}
				</View>
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}
