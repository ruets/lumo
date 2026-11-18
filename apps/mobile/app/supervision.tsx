// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSupervision, useSupervisionWrite } from "../src/hooks";
import { api } from "../src/session";
import { Button, Field, font, Screen, T } from "../src/ui";

const RIGHTS = ["canCreate", "canModify", "canDelete", "canTransfer"] as const;

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

function Codes() {
	const [shown, setShown] = useState<string | null>(null);
	const [code, setCode] = useState("");
	const make = useSupervisionWrite((kind: "supervise" | "be_supervised") => api.createSupervisionCode(kind));
	const redeem = useSupervisionWrite((c: string) => api.redeemSupervisionCode(c));
	return (
		<>
			<Button
				variant="ghost"
				label={t("supervision.codeSupervise")}
				onPress={() => make.mutate("supervise", { onSuccess: (r) => setShown(r.token) })}
			/>
			<Button
				variant="ghost"
				label={t("supervision.codeBeSupervised")}
				onPress={() => make.mutate("be_supervised", { onSuccess: (r) => setShown(r.token) })}
			/>
			{shown && (
				<View style={{ gap: 6 }}>
					<T style={{ color: colors.muted, fontSize: 14 }}>{t("supervision.codeShown")}</T>
					<T selectable style={{ backgroundColor: colors.background, borderRadius: 12, padding: 12, fontSize: 14 }}>
						{shown}
					</T>
				</View>
			)}
			<Field
				label={t("supervision.redeemTitle")}
				value={code}
				onChangeText={setCode}
				autoCapitalize="none"
				autoCorrect={false}
			/>
			<T style={{ color: colors.muted, fontSize: 12 }}>{t("supervision.redeemHint")}</T>
			<Button
				label={t("supervision.redeem")}
				disabled={code.trim().length < 10 || redeem.isPending}
				onPress={() => redeem.mutate(code.trim(), { onSuccess: () => setCode("") })}
			/>
		</>
	);
}

function CreateWard() {
	const create = useSupervisionWrite((input: Parameters<typeof api.createWardAccount>[0]) =>
		api.createWardAccount(input),
	);
	const [displayName, setDisplayName] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	return (
		<View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
			<T style={{ fontFamily: font.bold, fontSize: 14 }}>{t("supervision.createAccount")}</T>
			<Field label={t("admin.user.displayName")} value={displayName} onChangeText={setDisplayName} maxLength={80} />
			<Field
				label={t("auth.username")}
				value={username}
				onChangeText={setUsername}
				autoCapitalize="none"
				autoCorrect={false}
			/>
			<Field
				label={t("auth.password")}
				value={password}
				onChangeText={setPassword}
				secureTextEntry
				autoCapitalize="none"
			/>
			<Button
				label={t("supervision.createAccount")}
				disabled={create.isPending || !displayName.trim() || username.trim().length < 3 || password.length < 10}
				onPress={() =>
					create.mutate(
						{ displayName: displayName.trim(), username: username.trim(), password },
						{
							onSuccess: () => {
								setDisplayName("");
								setUsername("");
								setPassword("");
							},
						},
					)
				}
			/>
		</View>
	);
}

export default function SupervisionScreen() {
	const router = useRouter();
	const data = useSupervision().data;
	return (
		<Screen topInset={false}>
			<Stack.Screen
				options={{
					headerShown: true,
					headerBackButtonDisplayMode: "minimal",
					title: t("supervision.title"),
					headerStyle: { backgroundColor: colors.background },
					headerTintColor: colors.text,
					headerTitleStyle: { fontFamily: font.bold },
					headerShadowVisible: false,
				}}
			/>
			{data && (
				<Section title={t("supervision.guardians")}>
					{data.guardians.length === 0 ? (
						<T style={{ color: colors.muted, fontSize: 14 }}>{t("supervision.noGuardians")}</T>
					) : (
						<>
							<T style={{ fontFamily: font.bold, fontSize: 15 }}>
								{data.guardians.map((g) => g.displayName).join(", ")}
							</T>
							<T style={{ fontFamily: font.bold, fontSize: 14, color: colors.muted }}>{t("supervision.rights")}</T>
							{RIGHTS.map((r) => (
								<T key={r} style={{ fontSize: 14 }}>
									{data.rights?.[r] ? "✓" : "✗"} {t(`supervision.right.${r}` as const)}
								</T>
							))}
						</>
					)}
				</Section>
			)}
			{data && !data.rights && (
				<Section title={t("supervision.wards")}>
					{data.wards.length === 0 && <T style={{ color: colors.muted, fontSize: 14 }}>{t("supervision.noWards")}</T>}
					{data.wards.map((w) => (
						<Pressable
							key={w.id}
							accessibilityRole="button"
							onPress={() => router.push(`/ward/${w.id}`)}
							style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
						>
							<T style={{ fontFamily: font.bold, fontSize: 15 }}>{w.displayName}</T>
							<T style={{ color: colors.primaryLink, fontSize: 14 }}>{t("supervision.manage")} ›</T>
						</Pressable>
					))}
					<CreateWard />
				</Section>
			)}
			<Section title={t("supervision.redeemTitle")}>
				<Codes />
			</Section>
		</Screen>
	);
}
