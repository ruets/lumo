// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { logout } from "../src/account";
import { useAccount, useCreateOwnHousehold, useJoinHousehold } from "../src/hooks";
import { LanguagePicker } from "../src/locale";
import { Button, Field, font, Screen, T, Title } from "../src/ui";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<View style={{ backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, gap: 12 }}>
			<T style={{ fontFamily: font.bold, fontSize: 15, color: colors.muted }}>{title}</T>
			{children}
		</View>
	);
}

/** An account that is in no household: join with a code, create one (when allowed), administer, or sign out. */
export default function NoHouseholdScreen() {
	const account = useAccount().data;
	const router = useRouter();
	const join = useJoinHousehold();
	const create = useCreateOwnHousehold();
	const [code, setCode] = useState("");
	const [name, setName] = useState("");
	if (!account) return null;
	return (
		<Screen>
			<Title>{t("noHousehold.title")}</Title>
			<T style={{ color: colors.muted, fontSize: 14 }}>
				{account.canCreateHousehold ? t("noHousehold.hint") : t("noHousehold.hintClosed")}
			</T>
			<Card title={t("noHousehold.joinTitle")}>
				<Field
					label={t("noHousehold.code")}
					value={code}
					onChangeText={setCode}
					autoCapitalize="none"
					autoCorrect={false}
				/>
				<Button
					label={t("noHousehold.join")}
					disabled={code.trim().length < 10 || join.isPending}
					onPress={() => join.mutate(code.trim())}
				/>
			</Card>
			{account.canCreateHousehold && (
				<Card title={t("noHousehold.createTitle")}>
					<Field label={t("noHousehold.createName")} value={name} onChangeText={setName} maxLength={80} />
					<Button
						label={t("noHousehold.create")}
						disabled={name.trim().length === 0 || create.isPending}
						onPress={() => create.mutate(name.trim())}
					/>
				</Card>
			)}
			{account.isSuperAdmin && <Button label={t("admin.open")} variant="ghost" onPress={() => router.push("/admin")} />}
			<LanguagePicker showTitle={false} />
			<Button label={t("auth.logout")} variant="ghost" onPress={() => void logout()} />
		</Screen>
	);
}
