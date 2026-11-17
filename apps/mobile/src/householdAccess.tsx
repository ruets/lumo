// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountResponse } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { useState } from "react";
import { View } from "react-native";
import { useCreateOwnHousehold, useJoinHousehold } from "./hooks";
import { Button, Field, T } from "./ui";

/** For an account in no household: join one with a code, or create one when the instance allows it. */
export function HouseholdAccess({ account }: { account: AccountResponse }) {
	const join = useJoinHousehold();
	const create = useCreateOwnHousehold();
	const [code, setCode] = useState("");
	const [name, setName] = useState("");
	return (
		<View style={{ gap: 12 }}>
			<T style={{ color: colors.muted, fontSize: 14 }}>{t("noHousehold.settingsHint")}</T>
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
			{account.canCreateHousehold && (
				<>
					<Field label={t("noHousehold.createName")} value={name} onChangeText={setName} maxLength={80} />
					<Button
						label={t("noHousehold.create")}
						disabled={name.trim().length === 0 || create.isPending}
						onPress={() => create.mutate(name.trim())}
					/>
				</>
			)}
		</View>
	);
}
