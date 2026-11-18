// SPDX-License-Identifier: AGPL-3.0-or-later
import { inSpace, spaceLabel, type TodayItem } from "@lumo/api-client";
import { longDate, t } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { statsWindow, useBalance, useMe, usePending, useReview, useRewards, useStats, useToday } from "../../src/hooks";
import { awaitingReview, itemMeta, withSpace } from "../../src/itemMeta";
import { enqueueCompletion, useQueue } from "../../src/queue";
import { useRefresh } from "../../src/refresh";
import { SpacePills } from "../../src/SpacePills";
import { useSpaceFilter } from "../../src/space";
import { Avatar, BalanceChip, Bar, Button, CoinIcon, font, Reward, Ring, Screen, T, Title } from "../../src/ui";

function RemainingRow({ e, space, onTap }: { e: TodayItem; space: string | null; onTap: () => void }) {
	const waiting = awaitingReview(e);
	const multi = e.target > 1;
	const label = multi
		? t("items.validateCount", { name: e.item.name, current: e.approved, target: e.target, count: e.item.reward })
		: t("items.validate", { name: e.item.name, count: e.item.reward });
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			disabled={waiting}
			onPress={onTap}
			style={({ pressed }) => ({
				minHeight: 60,
				flexDirection: "row",
				alignItems: "center",
				gap: 14,
				backgroundColor: pressed ? colors.surfaceRaised : colors.surface,
				borderRadius: 18,
				paddingHorizontal: 16,
				paddingVertical: 10,
				opacity: waiting ? 0.7 : 1,
			})}
		>
			<View
				style={{
					width: 34,
					height: 34,
					borderRadius: 17,
					borderWidth: 2,
					borderColor: colors.primarySoft,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{multi && (
					<T style={{ fontFamily: font.bold, fontSize: 11, color: colors.textSoft }}>{`${e.approved}/${e.target}`}</T>
				)}
			</View>
			<View style={{ flex: 1, gap: 2 }}>
				<T style={{ fontFamily: font.bold, fontSize: 15 }}>{e.item.name}</T>
				<T style={{ fontSize: 13, color: colors.muted }}>{withSpace(space, itemMeta(e))}</T>
			</View>
			<Reward amount={e.item.reward} />
		</Pressable>
	);
}

/** Completions waiting for the approval of this person as a guardian, with whose they are. */
function Approvals() {
	const pending = usePending();
	const review = useReview();
	const list = pending.data?.completions ?? [];
	if (list.length === 0) return null;
	return (
		<View style={{ gap: 10 }}>
			<T style={{ fontFamily: font.bold, fontSize: 15, color: colors.muted }}>{t("today.approvals")}</T>
			{list.map((c) => (
				<View
					key={c.id}
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: 8,
						backgroundColor: colors.surface,
						borderRadius: 18,
						padding: 12,
						paddingLeft: 16,
					}}
				>
					<View style={{ flex: 1 }}>
						<T style={{ fontFamily: font.bold, fontSize: 15 }}>{c.itemName}</T>
						<T style={{ fontSize: 13, color: colors.muted }}>{c.wardName}</T>
					</View>
					<Button
						label={t("today.reject")}
						variant="ghost"
						onPress={() => review.mutate({ wardId: c.wardId, id: c.id, approve: false })}
					/>
					<Button
						label={t("today.approve")}
						variant="coin"
						onPress={() => review.mutate({ wardId: c.wardId, id: c.id, approve: true })}
					/>
				</View>
			))}
		</View>
	);
}

export default function TodayScreen() {
	const router = useRouter();
	const me = useMe().data;
	const today = useToday();
	const rewards = useRewards();
	const queue = useQueue();
	const win = today.data ? statsWindow(today.data.date) : undefined;
	const stats = useStats(win?.from, win?.to);
	const refresh = useRefresh();
	const balance = useBalance(me?.wallets.personal.balance ?? 0);
	const filter = useSpaceFilter(me?.households ?? []);
	if (!me) return null;

	const entries = (today.data?.items ?? []).filter((e) => inSpace(filter, e.item));
	const done = entries.filter((e) => e.done).length;
	const pct = entries.length ? Math.round((100 * done) / entries.length) : 0;
	const earned = entries.reduce((sum, e) => sum + e.item.reward * e.approved, 0);
	const remaining = entries.filter((e) => !e.done);
	const streak = Math.max(0, ...(stats.data?.habits.map((h) => h.streak.current) ?? []));
	const personal = rewards.data?.rewards.filter((r) => r.fundedFrom === "personal" && inSpace(filter, r)) ?? [];
	const wish = personal.find((r) => r.cost > balance) ?? personal[0];

	return (
		<Screen onRefresh={refresh.run} refreshing={refresh.busy}>
			<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
				<View style={{ gap: 6, flex: 1 }}>
					<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.muted }}>
						{today.data ? longDate(today.data.date) : " "}
					</T>
					<Title>{t("today.title", { name: me.user.displayName })}</Title>
				</View>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 }}>
					<BalanceChip balance={balance} onPress={() => router.navigate("/wishes")} />
					<Avatar name={me.user.displayName} onPress={() => router.push("/settings")} />
				</View>
			</View>

			{queue.length > 0 && (
				<T accessibilityLiveRegion="polite" style={{ color: colors.coin, fontFamily: font.semi, fontSize: 13 }}>
					{t("common.pending", { count: queue.length })}
				</T>
			)}

			<View
				style={{
					backgroundColor: colors.primary,
					borderRadius: 28,
					padding: 22,
					flexDirection: "row",
					alignItems: "center",
					gap: 20,
				}}
			>
				<Ring pct={pct} label={t("today.ringLabel", { pct })} />
				<View style={{ flex: 1, gap: 6 }}>
					<T
						style={{ color: "#fff", fontFamily: font.bold, fontSize: 13, letterSpacing: 1, textTransform: "uppercase" }}
					>
						{t("today.yourDay")}
					</T>
					<T style={{ color: "#fff", fontFamily: font.display, fontSize: 19, lineHeight: 24 }}>
						{t("today.doneOf", { done, total: entries.length })}
					</T>
					<T style={{ color: "#fff", fontFamily: font.semi, fontSize: 14 }}>
						{t("today.earned", { count: earned })}
						{streak > 1 ? ` · ${t("today.streak", { count: streak })}` : ""}
					</T>
				</View>
			</View>

			<SpacePills households={me.households} value={filter} />

			<Approvals />

			<View style={{ gap: 10 }}>
				<T style={{ fontFamily: font.bold, fontSize: 15, color: colors.muted }}>{t("today.remaining")}</T>
				{today.data && remaining.length === 0 && (
					<T
						style={{
							backgroundColor: colors.surface,
							borderRadius: 18,
							padding: 18,
							color: colors.success,
							fontFamily: font.semi,
							fontSize: 15,
						}}
					>
						{t("today.allDone")}
					</T>
				)}
				{remaining.map((e) => (
					<RemainingRow
						key={e.item.id}
						e={e}
						space={spaceLabel(e.item, me.households, t("space.personal"))}
						onTap={() => today.data && void enqueueCompletion(e.item.id, today.data.date)}
					/>
				))}
			</View>

			{wish && (
				<Pressable
					accessibilityRole="link"
					onPress={() => router.navigate("/wishes")}
					style={{ backgroundColor: colors.surface, borderRadius: 22, padding: 18, gap: 10 }}
				>
					<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
						<T style={{ fontFamily: font.bold, fontSize: 13, color: colors.muted }}>{t("today.nextWish")}</T>
						<View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
							<CoinIcon size={13} />
							<T
								style={{ fontFamily: font.bold, fontSize: 13, color: colors.coin }}
							>{`${Math.min(balance, wish.cost)} / ${wish.cost}`}</T>
						</View>
					</View>
					<T style={{ fontFamily: font.bold, fontSize: 16 }}>{wish.name}</T>
					<Bar pct={(100 * balance) / wish.cost} />
					<T style={{ fontSize: 13, color: colors.muted }}>
						{balance >= wish.cost ? t("today.canAfford") : t("today.missing", { count: wish.cost - balance })}
					</T>
				</Pressable>
			)}
		</Screen>
	);
}
