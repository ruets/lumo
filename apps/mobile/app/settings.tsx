// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { Stack, useRouter } from "expo-router";
import { Alert, Pressable, View } from "react-native";
import { changeServer, logout } from "../src/account";
import { useAccount, useLeaveHousehold, useMe } from "../src/hooks";
import { HouseholdAccess } from "../src/householdAccess";
import { LanguagePicker } from "../src/locale";
import { currentServerUrl } from "../src/server";
import { Button, font, Screen, T } from "../src/ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<View style={{ gap: 10 }}>
			<T style={{ fontFamily: font.bold, fontSize: 15, color: colors.muted }}>{title}</T>
			<View style={{ backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, gap: 14 }}>
				{children}
			</View>
		</View>
	);
}

export default function SettingsScreen() {
	const me = useMe().data;
	const router = useRouter();
	const leave = useLeaveHousehold();
	const account = useAccount().data;
	const isSuperAdmin = account?.isSuperAdmin ?? false;
	return (
		<Screen topInset={false}>
			<Stack.Screen
				options={{
					headerShown: true,
					headerBackButtonDisplayMode: "minimal",
					title: t("settings.title"),
					headerStyle: { backgroundColor: colors.background },
					headerTintColor: colors.text,
					headerTitleStyle: { fontFamily: font.bold },
					headerShadowVisible: false,
				}}
			/>
			{me && (
				<Section title={t("settings.account")}>
					<T style={{ fontFamily: font.bold, fontSize: 18 }}>{me.user.displayName}</T>
					<T style={{ color: colors.muted, fontSize: 14 }}>
						{me.household && me.role
							? `${t(`role.${me.role}` as const)} · ${t("settings.household", { name: me.household.name })}`
							: t("settings.noHousehold")}
					</T>
					<Button label={t("auth.logout")} variant="ghost" onPress={() => void logout()} />
					{me.household && (
						<Button
							label={t("household.leave")}
							variant="ghost"
							disabled={leave.isPending}
							onPress={() =>
								Alert.alert(t("household.leave"), t("household.leaveConfirm", { name: me.household?.name ?? "" }), [
									{ text: t("common.cancel"), style: "cancel" },
									{ text: t("household.leave"), style: "destructive", onPress: () => leave.mutate() },
								])
							}
						/>
					)}
				</Section>
			)}
			{me && !me.household && account && (
				<Section title={t("settings.accessTitle")}>
					<HouseholdAccess account={account} />
				</Section>
			)}
			{me?.household && (
				<Pressable
					accessibilityRole="button"
					onPress={() => router.push("/household")}
					style={{
						minHeight: 52,
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						backgroundColor: colors.surface,
						borderRadius: radii.md,
						paddingHorizontal: spacing.md,
					}}
				>
					<T style={{ fontFamily: font.bold, fontSize: 15 }}>{t("household.open")}</T>
					<T style={{ fontSize: 20, color: colors.muted }}>›</T>
				</Pressable>
			)}
			{isSuperAdmin && (
				<Pressable
					accessibilityRole="button"
					onPress={() => router.push("/admin")}
					style={{
						minHeight: 52,
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						backgroundColor: colors.surface,
						borderRadius: radii.md,
						paddingHorizontal: spacing.md,
					}}
				>
					<T style={{ fontFamily: font.bold, fontSize: 15 }}>{t("admin.open")}</T>
					<T style={{ fontSize: 20, color: colors.muted }}>›</T>
				</Pressable>
			)}
			<Section title={t("language.title")}>
				<LanguagePicker showTitle={false} />
			</Section>
			<Section title={t("settings.server")}>
				<T style={{ color: colors.textSoft, fontSize: 14 }}>{currentServerUrl()}</T>
				<Button label={t("server.change")} variant="ghost" onPress={() => void changeServer()} />
			</Section>
		</Screen>
	);
}
