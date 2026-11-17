// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { Tabs } from "expo-router";
import { font, NAV_ICONS } from "../../src/ui";

const screens = [
	{ name: "index", key: "today", label: () => t("nav.today") },
	{ name: "habits", key: "habits", label: () => t("nav.habits") },
	{ name: "progress", key: "progress", label: () => t("nav.progress") },
	{ name: "wishes", key: "wishes", label: () => t("nav.wishes") },
] as const;

export default function TabsLayout() {
	return (
		<Tabs
			screenOptions={{
				headerShown: false,
				tabBarActiveTintColor: colors.primaryLink,
				tabBarInactiveTintColor: colors.mutedNav,
				tabBarLabelStyle: { fontFamily: font.bold, fontSize: 12 },
				tabBarStyle: { backgroundColor: colors.nav, borderTopColor: colors.border, height: 80, paddingTop: 8 },
				sceneStyle: { backgroundColor: colors.background },
			}}
		>
			{screens.map((s) => (
				<Tabs.Screen
					key={s.name}
					name={s.name}
					options={{ title: s.label(), tabBarIcon: ({ color }) => NAV_ICONS[s.key](String(color)) }}
				/>
			))}
		</Tabs>
	);
}
