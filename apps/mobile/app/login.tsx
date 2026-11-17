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
import { changeServer } from "../src/account";
import { describeError, keys, useAuthConfig } from "../src/hooks";
import { LanguagePicker } from "../src/locale";
import { currentServerUrl } from "../src/server";
import { api, saveTokens } from "../src/session";
import { Button, Field, font, T } from "../src/ui";

WebBrowser.maybeCompleteAuthSession();

/** Authentik button. A separate component: the OIDC hooks need a valid issuer, so it is only mounted when configured. */
function OidcButton({
	issuer,
	clientId,
	onError,
}: {
	issuer: string;
	clientId: string;
	onError: (message: string) => void;
}) {
	const qc = useQueryClient();
	// Authorization Code + PKCE driven by expo-auth-session; the API then exchanges the code.
	const discovery = useAutoDiscovery(issuer);
	const nonce = useMemo(() => randomUUID(), []);
	const redirectUri = makeRedirectUri({ scheme: "lumo", path: "auth" });
	const [request, response, promptAsync] = useAuthRequest(
		{
			clientId,
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
			.catch((err: unknown) => onError(describeError(err)));
	}, [response, request, redirectUri, nonce, qc, onError]);

	return <Button label={t("auth.oidc")} disabled={!request} onPress={() => void promptAsync()} />;
}

export default function Login() {
	const qc = useQueryClient();
	const config = useAuthConfig();
	const [error, setError] = useState<string | null>(null);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [householdName, setHouseholdName] = useState("");

	const done = () => qc.invalidateQueries({ queryKey: keys.me });

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
					{config.data?.oidc && config.data.oidcIssuer && config.data.oidcClientId && !config.data.setupRequired && (
						<OidcButton issuer={config.data.oidcIssuer} clientId={config.data.oidcClientId} onError={setError} />
					)}
					{config.data?.local && (
						<>
							{config.data.setupRequired && (
								<>
									<Field label={t("auth.setup.householdName")} value={householdName} onChangeText={setHouseholdName} />
									<Field label={t("auth.setup.displayName")} value={displayName} onChangeText={setDisplayName} />
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
					<T style={{ fontSize: 13, color: colors.muted }}>{t("server.current", { url: currentServerUrl() })}</T>
					<Button label={t("server.change")} variant="ghost" onPress={() => void changeServer()} />
					<LanguagePicker />
				</View>
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}
