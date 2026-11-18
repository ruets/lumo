// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountResponse } from "@lumo/api-client";
import { t, weekdayLong, weekdayNarrow } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useUpdateAccount } from "./hooks";
import { showToast } from "./store";
import { Button, Field, font, T } from "./ui";

/** The person's own time zone and first weekday: nobody has two "todays", whatever households they are in. */
export function AccountSettings({ account }: { account: AccountResponse }) {
	// Keyed on the saved values so the form resets to what the server now holds.
	return <AccountForm key={`${account.timezone}|${account.weekStart}`} account={account} />;
}

function AccountForm({ account }: { account: AccountResponse }) {
	const update = useUpdateAccount();
	const [timezone, setTimezone] = useState(account.timezone);
	const [weekStart, setWeekStart] = useState(account.weekStart);
	return (
		<View style={{ gap: 12 }}>
			<Field
				label={t("account.timezone")}
				value={timezone}
				onChangeText={setTimezone}
				autoCapitalize="none"
				autoCorrect={false}
			/>
			<T style={{ fontSize: 12, color: colors.muted }}>{t("account.timezoneHint")}</T>
			<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.muted }}>{t("account.weekStart")}</T>
			<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
				{[1, 2, 3, 4, 5, 6, 7].map((d) => (
					<Pressable
						key={d}
						accessibilityRole="button"
						accessibilityLabel={weekdayLong(d)}
						accessibilityState={{ selected: weekStart === d }}
						onPress={() => setWeekStart(d)}
						style={{
							width: 40,
							height: 44,
							borderRadius: 22,
							alignItems: "center",
							justifyContent: "center",
							backgroundColor: weekStart === d ? colors.primary : colors.surfaceRaised,
						}}
					>
						<T style={{ fontFamily: font.bold, fontSize: 14, color: weekStart === d ? "#fff" : colors.textSoft }}>
							{weekdayNarrow(d)}
						</T>
					</Pressable>
				))}
			</View>
			<Button
				label={t("account.save")}
				disabled={update.isPending}
				onPress={() =>
					update.mutate(
						{ timezone: timezone.trim(), weekStart },
						{ onSuccess: () => showToast(t("household.saved"), 1500) },
					)
				}
			/>
		</View>
	);
}
