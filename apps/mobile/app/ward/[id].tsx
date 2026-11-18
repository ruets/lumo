// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Switch, View } from "react-native";
import { ItemSheet, RewardSheet } from "../../src/forms";
import {
	useSupervision,
	useSupervisionWrite,
	useWardItems,
	useWardMe,
	useWardPending,
	useWardRewards,
} from "../../src/hooks";
import { api } from "../../src/session";
import { showToast } from "../../src/store";
import { AddButton, Button, Field, font, Screen, T } from "../../src/ui";

const RIGHTS = ["canCreate", "canModify", "canDelete", "canTransfer"] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<View style={{ gap: 10 }}>
			<T style={{ fontFamily: font.bold, fontSize: 15, color: colors.muted }}>{title}</T>
			<View style={{ backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, gap: 12 }}>
				{children}
			</View>
		</View>
	);
}

/** A guardian's view of one ward: rights, coins, approvals, and the ward's own habits, tasks and wishes. */
export default function WardScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const router = useRouter();
	const wardId = String(id);
	const ward = useSupervision().data?.wards.find((w) => w.id === wardId);
	const me = useWardMe(wardId);
	const items = useWardItems(wardId);
	const rewards = useWardRewards(wardId);
	const pending = useWardPending(wardId);
	const [adding, setAdding] = useState<"habit" | "task" | "wish" | null>(null);
	const [amount, setAmount] = useState("");
	const [note, setNote] = useState("");
	const setRight = useSupervisionWrite((input: Partial<Record<(typeof RIGHTS)[number], boolean>>) =>
		api.updateWardRights(wardId, input),
	);
	const review = useSupervisionWrite(({ cid, approve }: { cid: string; approve: boolean }) =>
		api.reviewWardCompletion(wardId, cid, approve),
	);
	const adjust = useSupervisionWrite((input: { amount: number; note: string }) => api.adjustWardCoins(wardId, input));
	const archive = useSupervisionWrite((itemId: string) => api.archiveWardItem(wardId, itemId));
	const end = useSupervisionWrite(() => api.endSupervision(wardId));

	if (!ward) return null;
	return (
		<Screen topInset={false}>
			<Stack.Screen
				options={{
					headerShown: true,
					headerBackButtonDisplayMode: "minimal",
					title: ward.displayName,
					headerStyle: { backgroundColor: colors.background },
					headerTintColor: colors.text,
					headerTitleStyle: { fontFamily: font.bold },
					headerShadowVisible: false,
				}}
			/>
			<Section title={t("supervision.rights")}>
				{RIGHTS.map((r) => (
					<View
						key={r}
						style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}
					>
						<T style={{ flex: 1, fontFamily: font.semi, fontSize: 14, color: colors.textSoft }}>
							{t(`supervision.right.${r}` as const)}
						</T>
						<Switch
							value={ward.rights[r]}
							onValueChange={(v) => setRight.mutate({ [r]: v })}
							trackColor={{ true: colors.primary }}
						/>
					</View>
				))}
			</Section>

			<Section title={t("supervision.ward.adjust")}>
				{me.data && (
					<T style={{ fontFamily: font.bold, fontSize: 14, color: colors.coin }}>
						{t("supervision.ward.balance", { amount: me.data.wallets.personal.balance })}
					</T>
				)}
				<Field
					label={t("admin.pot.amount")}
					value={amount}
					onChangeText={setAmount}
					keyboardType="numbers-and-punctuation"
				/>
				<Field label={t("admin.pot.note")} value={note} onChangeText={setNote} maxLength={500} />
				<Button
					label={t("supervision.ward.adjust")}
					disabled={!Number.isInteger(Number(amount)) || Number(amount) === 0 || !note.trim() || adjust.isPending}
					onPress={() =>
						adjust.mutate(
							{ amount: Number(amount), note: note.trim() },
							{
								onSuccess: () => {
									setAmount("");
									setNote("");
									showToast(t("admin.saved"), 1500);
								},
							},
						)
					}
				/>
			</Section>

			{(pending.data?.completions.length ?? 0) > 0 && (
				<Section title={t("supervision.ward.pending")}>
					{pending.data?.completions.map((c) => (
						<View key={c.id} style={{ gap: 8 }}>
							<T style={{ fontFamily: font.bold, fontSize: 15 }}>{c.itemName}</T>
							<View style={{ flexDirection: "row", gap: 8 }}>
								<Button
									variant="ghost"
									label={t("today.reject")}
									onPress={() => review.mutate({ cid: c.id, approve: false })}
								/>
								<Button label={t("today.approve")} onPress={() => review.mutate({ cid: c.id, approve: true })} />
							</View>
						</View>
					))}
				</Section>
			)}

			<Section title={t("supervision.ward.items")}>
				{items.data?.items.length === 0 && <T style={{ color: colors.muted, fontSize: 14 }}>{t("items.empty")}</T>}
				{items.data?.items.map((i) => (
					<View key={i.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
						<T style={{ flex: 1, fontFamily: font.bold, fontSize: 15 }}>{i.name}</T>
						<Button variant="ghost" label={t("supervision.ward.archive")} onPress={() => archive.mutate(i.id)} />
					</View>
				))}
				<AddButton label={t("items.newHabit")} onPress={() => setAdding("habit")} />
				<AddButton label={t("items.newTask")} onPress={() => setAdding("task")} />
			</Section>

			<Section title={t("supervision.ward.wishes")}>
				{rewards.data?.rewards.length === 0 && <T style={{ color: colors.muted, fontSize: 14 }}>{t("wishes.empty")}</T>}
				{rewards.data?.rewards.map((r) => (
					<T key={r.id} style={{ fontFamily: font.bold, fontSize: 15 }}>
						{r.name} · {r.cost}
					</T>
				))}
				<AddButton label={t("supervision.ward.addWish")} onPress={() => setAdding("wish")} />
			</Section>

			<Button
				variant="ghost"
				label={t("supervision.end")}
				onPress={() =>
					Alert.alert(t("supervision.end"), t("supervision.endConfirm", { name: ward.displayName }), [
						{ text: t("common.cancel"), style: "cancel" },
						{
							text: t("supervision.end"),
							style: "destructive",
							onPress: () => end.mutate(undefined, { onSuccess: () => router.back() }),
						},
					])
				}
			/>

			{me.data && (
				<>
					<ItemSheet
						kind={adding === "task" ? "task" : "habit"}
						visible={adding === "habit" || adding === "task"}
						onClose={() => setAdding(null)}
						ward={{ id: wardId, me: me.data }}
					/>
					<RewardSheet visible={adding === "wish"} onClose={() => setAdding(null)} ward={{ id: wardId, me: me.data }} />
				</>
			)}
		</Screen>
	);
}
