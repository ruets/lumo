// SPDX-License-Identifier: AGPL-3.0-or-later
import { inSpace, type RewardList, spaceLabel } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { RewardSheet } from "../../src/forms";
import { useBalance, useMe, useRedeem, useRewards, useToday } from "../../src/hooks";
import { withSpace } from "../../src/itemMeta";
import { useRefresh } from "../../src/refresh";
import { SpacePills } from "../../src/SpacePills";
import { useSpaceFilter } from "../../src/space";
import { AddButton, Bar, Button, CoinIcon, font, Screen, T, Title } from "../../src/ui";

type Reward = RewardList[number];

function meta(r: Reward): string {
	if (r.limitCount === null || r.limitPeriod === null)
		return r.link ? r.link.replace(/^https?:\/\//, "") : t("wishes.unlimited");
	const period = t(`wishes.period.${r.limitPeriod}` as const);
	return (r.remaining ?? 0) > 0
		? t("wishes.limitLeft", { count: r.remaining ?? 0, period })
		: t("wishes.limitNone", { period });
}

export default function WishesScreen() {
	const me = useMe().data;
	const rewards = useRewards();
	const redeem = useRedeem();
	const today = useToday();
	const refresh = useRefresh();
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<Reward | null>(null);
	const [last, setLast] = useState<Reward | null>(null);
	const balance = useBalance(me?.wallets.personal.balance ?? 0);
	const filter = useSpaceFilter(me?.households ?? []);
	if (!me) return null;
	const shown = (rewards.data?.rewards ?? []).filter((r) => inSpace(filter, r));
	const earnedToday = (today.data?.items ?? []).reduce((sum, e) => sum + e.item.reward * e.approved, 0);

	return (
		<Screen onRefresh={refresh.run} refreshing={refresh.busy}>
			<Title>{t("wishes.title")}</Title>

			<View style={{ backgroundColor: colors.primary, borderRadius: 26, padding: 20, gap: 6 }}>
				<T style={{ color: "#fff", fontFamily: font.bold, fontSize: 13, letterSpacing: 1, textTransform: "uppercase" }}>
					{t("wishes.balance")}
				</T>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
					<CoinIcon size={30} color="#fff" />
					<T style={{ color: "#fff", fontFamily: font.displayBold, fontSize: 34 }}>{balance}</T>
				</View>
				<T accessibilityLiveRegion="polite" style={{ color: "#fff", fontFamily: font.semi, fontSize: 14 }}>
					{last
						? t("wishes.redeemed", { name: last.name, cost: last.cost })
						: t("today.earned", { count: earnedToday })}
				</T>
				{me.wallets.shared && (
					<T style={{ color: "#fff", fontFamily: font.semi, fontSize: 13 }}>
						{t("wishes.sharedBalance", { amount: me.wallets.shared.balance })}
					</T>
				)}
			</View>

			<SpacePills households={me.households} value={filter} />

			{shown.length === 0 && <T style={{ color: colors.muted }}>{t("wishes.empty")}</T>}
			<View style={{ gap: 10 }}>
				{shown.map((r) => {
					const wallet = r.fundedFrom === "shared" ? (me.wallets.shared?.balance ?? 0) : balance;
					const exhausted = r.limitCount !== null && (r.remaining ?? 0) <= 0;
					const canBuy = wallet >= r.cost && !exhausted;
					return (
						<View
							key={r.id}
							style={{
								backgroundColor: colors.surface,
								borderRadius: 20,
								paddingHorizontal: 16,
								paddingVertical: 14,
								gap: 10,
							}}
						>
							<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={t("wishes.editLabel", { name: r.name })}
									onPress={() => setEditing(r)}
									style={{ flex: 1, gap: 3, minHeight: 44, justifyContent: "center" }}
								>
									<T style={{ fontFamily: font.bold, fontSize: 16 }}>{r.name}</T>
									<T style={{ fontSize: 13, color: colors.muted }}>
										{withSpace(spaceLabel(r, me.households, t("space.personal")), meta(r))}
									</T>
								</Pressable>
								{canBuy ? (
									<Button
										variant="coin"
										label={`◎ ${r.cost}`}
										accessibilityLabel={t("wishes.redeem", { name: r.name, count: r.cost })}
										disabled={redeem.isPending}
										onPress={() => redeem.mutate(r.id, { onSuccess: () => setLast(r) })}
									/>
								) : (
									<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
										<CoinIcon size={16} color={colors.textSoft} />
										<T style={{ fontFamily: font.bold, fontSize: 14, color: colors.textSoft }}>{r.cost}</T>
									</View>
								)}
							</View>
							{!canBuy && (
								<View style={{ gap: 6 }}>
									<Bar pct={exhausted ? 100 : (100 * wallet) / r.cost} color={colors.primarySoft} />
									<T style={{ fontSize: 13, color: colors.muted }}>
										{exhausted ? t("wishes.comesBack") : t("today.missing", { count: r.cost - wallet })}
									</T>
								</View>
							)}
						</View>
					);
				})}
			</View>

			<AddButton label={t("wishes.new")} onPress={() => setCreating(true)} />
			<RewardSheet visible={creating} onClose={() => setCreating(false)} />
			{editing && <RewardSheet reward={editing} visible onClose={() => setEditing(null)} />}
		</Screen>
	);
}
