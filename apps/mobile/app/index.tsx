// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError, type AuthConfig, type MeResponse, type TokenPair } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { makeRedirectUri, useAuthRequest, useAutoDiscovery } from "expo-auth-session";
import { randomUUID } from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { OIDC_CLIENT_ID, OIDC_ISSUER } from "../src/config";
import { api, clearTokens, saveTokens } from "../src/session";

WebBrowser.maybeCompleteAuthSession();

type State =
	| { status: "loading" }
	| { status: "anonymous"; config: AuthConfig }
	| { status: "authenticated"; me: MeResponse };

export default function Index() {
	const [state, setState] = useState<State>({ status: "loading" });

	const refresh = useCallback(async () => {
		try {
			setState({ status: "authenticated", me: await api.getMe() });
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				setState({ status: "anonymous", config: await api.getAuthConfig() });
			} else {
				throw err;
			}
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return (
		<SafeAreaView style={styles.screen}>
			{state.status === "loading" && <ActivityIndicator />}
			{state.status === "anonymous" && <Login config={state.config} onDone={refresh} />}
			{state.status === "authenticated" && <Home me={state.me} onLogout={refresh} />}
		</SafeAreaView>
	);
}

function Login({ config, onDone }: { config: AuthConfig; onDone: () => Promise<void> }) {
	const [error, setError] = useState<string | null>(null);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");

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
				await onDone();
			})
			.catch((err: unknown) => setError(err instanceof ApiError ? err.message : t("auth.error")));
	}, [response, request, redirectUri, nonce, onDone]);

	async function loginLocal() {
		setError(null);
		try {
			const tokens = (await api.loginLocal({ username, password, client: "mobile" })) as TokenPair;
			await saveTokens(tokens);
			await onDone();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : t("auth.error"));
		}
	}

	return (
		<View style={styles.card}>
			<Text style={styles.title}>{t("app.name")}</Text>
			{error && <Text style={styles.error}>{error}</Text>}
			{config.oidc && OIDC_ISSUER !== "" && (
				<Pressable style={styles.button} disabled={!request} onPress={() => void promptAsync()}>
					<Text style={styles.buttonText}>{t("auth.oidc")}</Text>
				</Pressable>
			)}
			{config.local && (
				<>
					<TextInput
						style={styles.input}
						placeholder={t("auth.username")}
						autoCapitalize="none"
						value={username}
						onChangeText={setUsername}
					/>
					<TextInput
						style={styles.input}
						placeholder={t("auth.password")}
						secureTextEntry
						value={password}
						onChangeText={setPassword}
					/>
					<Pressable style={styles.button} onPress={() => void loginLocal()}>
						<Text style={styles.buttonText}>{t("auth.submit")}</Text>
					</Pressable>
				</>
			)}
		</View>
	);
}

function Home({ me, onLogout }: { me: MeResponse; onLogout: () => Promise<void> }) {
	async function logout() {
		await api.logout().catch(() => undefined);
		await clearTokens();
		await onLogout();
	}
	return (
		<View style={styles.card}>
			<Text style={styles.title}>{t("home.greeting", { name: me.user.displayName })}</Text>
			<Text>{t("home.household", { name: me.household.name })}</Text>
			<Text>{t("home.wallet.personal", { amount: me.wallets.personal.balance })}</Text>
			<Text>{t("home.wallet.shared", { amount: me.wallets.shared.balance })}</Text>
			<Pressable style={styles.button} onPress={() => void logout()}>
				<Text style={styles.buttonText}>{t("auth.logout")}</Text>
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: spacing.md },
	card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, gap: spacing.md },
	title: { fontSize: 28, fontWeight: "700", color: colors.text },
	error: { color: colors.danger },
	input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: radii.sm, padding: spacing.sm },
	button: { backgroundColor: colors.primary, borderRadius: radii.sm, padding: spacing.sm, alignItems: "center" },
	buttonText: { color: colors.primaryText, fontWeight: "600" },
});
