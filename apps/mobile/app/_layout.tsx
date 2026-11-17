// SPDX-License-Identifier: AGPL-3.0-or-later
import { Manrope_400Regular, Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope";
import { Unbounded_500Medium, Unbounded_700Bold } from "@expo-google-fonts/unbounded";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useMe } from "../src/hooks";
import { bindQueryClient, flushQueue, loadQueue } from "../src/queue";

const queryClient = new QueryClient({
	defaultOptions: { queries: { staleTime: 10_000, retry: 1, gcTime: 24 * 3_600_000 } },
});
bindQueryClient(queryClient);
const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "lumo.query-cache.v1" });

function Routes() {
	const me = useMe();
	const authed = Boolean(me.data);

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

	if (me.isPending) return null;
	return (
		<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0E1220" } }}>
			<Stack.Protected guard={authed}>
				<Stack.Screen name="(tabs)" />
			</Stack.Protected>
			<Stack.Protected guard={!authed}>
				<Stack.Screen name="login" />
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
