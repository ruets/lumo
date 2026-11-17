// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LedgerEntry } from "@lumo/api-client";
import { type ProgressPeriod, summarizeProgress } from "@lumo/domain";
import { dayNumber, shortDate, t, weekdayShort } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { statsWindow, useLedger, useMe, useStats, useToday, useUndoRedemption } from "../../src/hooks";
import { useRefresh } from "../../src/refresh";
import { showToast } from "../../src/store";
import { font, Screen, Segmented, T, Title } from "../../src/ui";

function entryLabel(e: LedgerEntry): string {
	if (e.label) {
		if (e.reason !== "undo") return e.label;
		// Le remboursement d'un échange est positif ; l'annulation d'une validation est négative.
		return `${e.amount > 0 ? t("ledger.undoRedemption") : t("ledger.undo")} · ${e.label}`;
	}
	if (e.note) return e.note;
	return t(`ledger.${e.reason}` as const);
}

export default function ProgressScreen() {
	const router = useRouter();
	const me = useMe().data;
	const [period, setPeriod] = useState<ProgressPeriod>("week");
	const now = useToday();
	const win = now.data ? statsWindow(now.data.date) : undefined;
	const stats = useStats(win?.from, win?.to);
	const ledger = useLedger();
	const undoRedemption = useUndoRedemption();
	const refresh = useRefresh();

	if (!me || !now.data || !stats.data)
		return (
			<Screen>
				<T>{t("common.loading")}</T>
			</Screen>
		);

	const s = summarizeProgress(stats.data.heatmap, now.data.date, period);
	const maxExpected = Math.max(1, ...s.bars.map((b) => b.expected));
	const streak = Math.max(0, ...stats.data.habits.map((h) => h.streak.current));
	const entries = ledger.data?.entries ?? [];
	// Un échange est annulable tant qu'aucun remboursement ne le référence (le remboursement est plus récent, donc listé).
	const refunded = new Set(entries.filter((e) => e.reason === "undo" && e.amount > 0).map((e) => e.refId));
	const cancel = (e: LedgerEntry) => {
		const id = e.refId;
		if (!id) return;
		const amount = Math.abs(e.amount);
		Alert.alert(t("ledger.undoAction"), t("ledger.undoConfirm", { amount }), [
			{ text: t("common.cancel"), style: "cancel" },
			{
				text: t("ledger.undoAction"),
				onPress: () =>
					undoRedemption.mutate(id, {
						onSuccess: () => showToast(t("ledger.undone", { amount })),
						onError: () => showToast(t("common.offline")),
					}),
			},
		]);
	};
	const earned = entries
		.filter((e) => e.createdAt.slice(0, 10) >= s.from && e.createdAt.slice(0, 10) <= s.to)
		.reduce((sum, e) => (e.reason === "completion" || e.reason === "undo" ? sum + e.amount : sum), 0);
	const letter = (iso: string) => weekdayShort(((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1).charAt(0);

	return (
		<Screen onRefresh={refresh.run} refreshing={refresh.busy}>
			<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
				<Title>{t("progress.title")}</Title>
				<View style={{ width: 190 }}>
					<Segmented
						value={period}
						onChange={setPeriod}
						options={[
							{ id: "week", label: t("progress.week") },
							{ id: "month", label: t("progress.month") },
						]}
					/>
				</View>
			</View>

			<View style={{ backgroundColor: colors.surface, borderRadius: 26, padding: 20, gap: 16 }}>
				<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
					<View style={{ gap: 4, flexShrink: 1 }}>
						<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.muted }}>
							{period === "week" ? t("progress.weekCaption") : t("progress.monthCaption")}
						</T>
						<T style={{ fontFamily: font.displayBold, fontSize: 34 }}>
							{s.rate === null ? t("progress.noRate") : `${s.rate} %`}
						</T>
					</View>
					{s.trend !== null && (
						<T
							style={{
								fontFamily: font.bold,
								fontSize: 13,
								color: s.trend >= 0 ? colors.success : colors.danger,
								textAlign: "right",
								flexShrink: 1,
								maxWidth: 130,
							}}
						>
							{t("progress.trend", { sign: s.trend >= 0 ? "+" : "−", pts: Math.abs(s.trend) })}
						</T>
					)}
				</View>
				<View
					accessibilityRole="image"
					accessibilityLabel={`${s.done} sur ${s.expected} validées, ${s.rate ?? 0} %`}
					style={{ height: 140, flexDirection: "row", alignItems: "flex-end", gap: 10 }}
				>
					{s.bars.map((b) => (
						<View
							key={b.from}
							style={{ flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center", gap: 8 }}
						>
							<View
								style={{
									width: "100%",
									maxWidth: 34,
									borderRadius: 10,
									height: b.future ? 4 : Math.max(4, Math.round((100 * b.done) / maxExpected)),
									backgroundColor: b.current ? colors.success : b.future ? colors.surfaceRaised : colors.primarySoft,
								}}
							/>
							<T style={{ fontFamily: font.semi, fontSize: 12, color: colors.muted }}>
								{period === "week" ? letter(b.from) : dayNumber(b.from)}
							</T>
						</View>
					))}
				</View>
			</View>

			<View style={{ flexDirection: "row", gap: 10 }}>
				{[
					[t("progress.done"), String(s.done)],
					[t("progress.earned"), String(earned)],
					[t("progress.streak"), t("progress.days", { days: streak })],
				].map(([label, value]) => (
					<View key={label} style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 20, padding: 14, gap: 6 }}>
						<T style={{ fontFamily: font.semi, fontSize: 12, color: colors.muted }}>{label}</T>
						<T style={{ fontFamily: font.displayBold, fontSize: 20 }}>{value}</T>
					</View>
				))}
			</View>

			<View style={{ gap: 10 }}>
				<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
					<T style={{ fontFamily: font.bold, fontSize: 15, color: colors.muted }}>{t("progress.lastCoins")}</T>
					<Pressable
						accessibilityRole="link"
						onPress={() => router.navigate("/wishes")}
						style={{ minHeight: 44, justifyContent: "center" }}
					>
						<T style={{ fontFamily: font.bold, fontSize: 14, color: colors.primaryLink }}>
							{t("progress.balance", { amount: me.wallets.personal.balance })}
						</T>
					</Pressable>
				</View>
				<View style={{ backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 16 }}>
					{entries.slice(0, 8).map((e, i, arr) => (
						<View
							key={e.id}
							style={{
								minHeight: 58,
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "space-between",
								gap: 12,
								borderBottomWidth: i < arr.length - 1 ? 1 : 0,
								borderBottomColor: colors.border,
							}}
						>
							<View style={{ flex: 1, gap: 2 }}>
								<T style={{ fontFamily: font.semi, fontSize: 15 }}>{entryLabel(e)}</T>
								<T style={{ fontSize: 12, color: colors.muted }}>{shortDate(e.createdAt.slice(0, 10))}</T>
							</View>
							<View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
								{e.reason === "redemption" && e.refId && !refunded.has(e.refId) && (
									<Pressable
										accessibilityRole="button"
										accessibilityLabel={t("ledger.undoActionFor", { name: e.label ?? "" })}
										disabled={undoRedemption.isPending}
										onPress={() => cancel(e)}
										style={{
											minHeight: 44,
											paddingHorizontal: 12,
											borderRadius: 22,
											borderWidth: 1,
											borderColor: colors.borderDashed,
											justifyContent: "center",
										}}
									>
										<T style={{ fontFamily: font.bold, fontSize: 12, color: colors.textSoft }}>
											{t("ledger.undoAction")}
										</T>
									</Pressable>
								)}
								{e.reason === "redemption" && e.refId && refunded.has(e.refId) && (
									<T style={{ fontFamily: font.semi, fontSize: 12, color: colors.muted }}>{t("ledger.refunded")}</T>
								)}
								<T
									style={{
										fontFamily: font.displayBold,
										fontSize: 15,
										color: e.amount > 0 ? colors.coin : colors.textSoft,
									}}
								>
									{e.amount > 0 ? "+" : "−"}
									{Math.abs(e.amount)}
								</T>
							</View>
						</View>
					))}
				</View>
			</View>
		</Screen>
	);
}
