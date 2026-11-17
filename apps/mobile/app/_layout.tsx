// SPDX-License-Identifier: AGPL-3.0-or-later
import { Manrope_400Regular, Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope";
import { Unbounded_500Medium, Unbounded_700Bold } from "@expo-google-fonts/unbounded";
import NetInfo from "@react-native-community/netinfo";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useMe } from "../src/hooks";
import { persister, queryClient } from "../src/query";
import { flushQueue, loadQueue } from "../src/queue";
import { loadServer, useServer } from "../src/server";

function Routes() {
	const server = useServer();
	const hasServer = server.url !== null;
	const me = useMe(hasServer);
	const authed = hasServer && Boolean(me.data);

	useEffect(() => {
		void loadServer();
	}, []);

	// File hors ligne : on l'envoie au démarrage, au retour au premier plan et au retour du réseau.
	useEffect(() => {
		if (!authed) return;
		void loadQueue().then(flushQueue);
		const app = AppState.addEventListener("change", (st) => st === "active" && void flushQueue());
		const net = NetInfo.addEventListener((st) => st.isConnected && void flushQueue());
		return () => {
			app.remove();
			net();
		};
	}, [authed]);

	if (!server.loaded || (hasServer && me.isPending)) return null;
	return (
		<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0E1220" } }}>
			<Stack.Protected guard={authed}>
				<Stack.Screen name="(tabs)" />
			</Stack.Protected>
			<Stack.Protected guard={hasServer && !authed}>
				<Stack.Screen name="login" />
			</Stack.Protected>
			<Stack.Protected guard={!hasServer}>
				<Stack.Screen name="server" />
			</Stack.Protected>
		</Stack>
	);
}

export default function RootLayout() {
	const [fontsLoaded] = useFonts({
		Manrope_400Regular,
		Manrope_600SemiBold,
		Manrope_700Bold,
		Unbounded_500Medium,
		Unbounded_700Bold,
	});
	if (!fontsLoaded) return null;
	return (
		<SafeAreaProvider>
			<PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 24 * 3_600_000 }}>
				<StatusBar style="light" />
				<Routes />
			</PersistQueryClientProvider>
		</SafeAreaProvider>
	);
}
