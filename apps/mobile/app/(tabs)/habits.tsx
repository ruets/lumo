// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Item, inSpace, spaceLabel, type TodayItem } from "@lumo/api-client";
import { addDays, startOfWeek } from "@lumo/domain";
import { dayNumber, longDate, shortDate, t, weekdayShort } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ItemSheet } from "../../src/forms";
import { useBalance, useMe, useStats, useToday, useUndo } from "../../src/hooks";
import { itemMeta, withSpace } from "../../src/itemMeta";
import { dequeueLast, enqueueCompletion } from "../../src/queue";
import { useRefresh } from "../../src/refresh";
import { SpacePills } from "../../src/SpacePills";
import { useSpaceFilter } from "../../src/space";
import { showToast } from "../../src/store";
import { AddButton, BalanceChip, font, Reward, Screen, Segmented, T, Title } from "../../src/ui";

function Row({
	e,
	space,
	future,
	onComplete,
	onUndo,
	onEdit,
}: {
	e: TodayItem;
	space: string | null;
	future: boolean;
	onComplete: () => void;
	onUndo: () => void;
	onEdit: () => void;
}) {
	const multi = e.target > 1;
	const label = e.done
		? t("items.undo", { name: e.item.name })
		: multi
			? t("items.validateCount", { name: e.item.name, current: e.approved, target: e.target, count: e.item.reward })
			: t("items.validate", { name: e.item.name, count: e.item.reward });
	const waiting = !e.done && e.approved + e.pending >= e.target;
	return (
		<View
			style={{
				minHeight: 66,
				flexDirection: "row",
				alignItems: "center",
				gap: 12,
				borderRadius: 18,
				paddingVertical: 10,
				paddingLeft: 10,
				paddingRight: 16,
				backgroundColor: e.done ? colors.surfaceDone : colors.surface,
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={label}
				disabled={future || waiting}
				onPress={e.done ? onUndo : onComplete}
				style={{
					width: 44,
					height: 44,
					borderRadius: 22,
					alignItems: "center",
					justifyContent: "center",
					opacity: future || waiting ? 0.5 : 1,
					backgroundColor: e.done ? colors.success : "transparent",
					borderWidth: e.done ? 0 : 2,
					borderColor: colors.primarySoft,
				}}
			>
				<T style={{ fontFamily: font.bold, fontSize: 12, color: e.done ? colors.onCoin : colors.textSoft }}>
					{e.done ? "✓" : multi ? `${e.approved}/${e.target}` : ""}
				</T>
			</Pressable>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t("items.edit", { name: e.item.name })}
				onPress={onEdit}
				style={{ flex: 1, gap: 3, minHeight: 44, justifyContent: "center" }}
			>
				<T
					style={{
						fontFamily: font.bold,
						fontSize: 15,
						color: e.done ? "#8F8EA8" : colors.text,
						textDecorationLine: e.done ? "line-through" : "none",
					}}
				>
					{e.item.name}
				</T>
				<T style={{ fontSize: 13, color: colors.muted }}>{withSpace(space, itemMeta(e))}</T>
			</Pressable>
			<Reward amount={e.item.reward} />
		</View>
	);
}

function WeekArrow({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			style={{ width: 28, height: 70, alignItems: "center", justifyContent: "center" }}
		>
			<T style={{ fontFamily: font.bold, fontSize: 24, color: colors.textSoft }}>{glyph}</T>
		</Pressable>
	);
}

export default function HabitsScreen() {
	const router = useRouter();
	const me = useMe().data;
	const undo = useUndo();
	const refresh = useRefresh();
	const [picked, setPicked] = useState<string | null>(null);
	const [tab, setTab] = useState<"habit" | "task">("habit");
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<Item | null>(null);
	const filter = useSpaceFilter(me?.households ?? []);

	const now = useToday();
	const today = now.data?.date;
	const day = picked ?? today;
	const view = useToday(picked && picked !== today ? picked : undefined);
	const weekFrom = today && day ? startOfWeek(day, 1) : undefined;
	const stats = useStats(weekFrom, weekFrom ? addDays(weekFrom, 6) : undefined);
	const balance = useBalance(me?.wallets.personal.balance ?? 0);
	if (!me || !today || !day || !weekFrom)
		return (
			<Screen>
				<T>{t("common.loading")}</T>
			</Screen>
		);

	const goTo = (d: string) => setPicked(d === today ? null : d);
	const days = Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i));
	const heat = new Map(stats.data?.heatmap.map((h) => [h.date, h]));
	const entries = ((picked && picked !== today ? view.data : now.data)?.items ?? []).filter((e) =>
		inSpace(filter, e.item),
	);
	const list = entries.filter((e) => e.item.kind === tab);
	const doneCount = entries.filter((e) => e.done).length;

	async function onUndo(e: TodayItem) {
		if (await dequeueLast(e.item.id, day as string)) return; // never sent: remove it from the queue
		const id = e.completionIds[0];
		if (id) undo.mutate(id, { onError: () => showToast(t("common.offline")) });
	}

	return (
		<Screen onRefresh={refresh.run} refreshing={refresh.busy}>
			<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
				<View style={{ gap: 6 }}>
					<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.muted }}>
						{shortDate(day)} · {t("today.doneOf", { done: doneCount, total: entries.length })}
					</T>
					<Title>{t("nav.habits")}</Title>
				</View>
				<BalanceChip balance={balance} onPress={() => router.navigate("/wishes")} />
			</View>

			<SpacePills households={me?.households ?? []} value={filter} />

			<Segmented
				value={tab}
				onChange={setTab}
				options={[
					{ id: "habit", label: t("items.habits") },
					{ id: "task", label: t("items.tasks") },
				]}
			/>

			<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
				<WeekArrow label={t("items.prevWeek")} glyph="‹" onPress={() => goTo(addDays(day, -7))} />
				{days.map((d, i) => {
					const h = heat.get(d);
					const on = d === day;
					const dot =
						!h || h.expected === 0
							? "transparent"
							: h.done >= h.expected
								? colors.success
								: h.done > 0
									? colors.coin
									: "transparent";
					return (
						<Pressable
							key={d}
							accessibilityRole="button"
							accessibilityState={{ selected: on }}
							accessibilityLabel={t("items.dayLabel", {
								date: longDate(d),
								done: h?.done ?? 0,
								total: h?.expected ?? 0,
							})}
							onPress={() => goTo(d)}
							style={{
								flex: 1,
								height: 70,
								borderRadius: 16,
								alignItems: "center",
								justifyContent: "center",
								gap: 3,
								backgroundColor: on ? colors.primary : colors.surface,
							}}
						>
							<T style={{ fontFamily: font.semi, fontSize: 12, color: on ? "#fff" : colors.textSoft }}>
								{weekdayShort(i + 1)}
							</T>
							<T style={{ fontFamily: font.displayBold, fontSize: 16, color: on ? "#fff" : colors.textSoft }}>
								{dayNumber(d)}
							</T>
							<View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
						</Pressable>
					);
				})}
				<WeekArrow label={t("items.nextWeek")} glyph="›" onPress={() => goTo(addDays(day, 7))} />
			</View>

			<View style={{ gap: 10 }}>
				{list.length === 0 && <T style={{ color: colors.muted }}>{t("items.empty")}</T>}
				{list.map((e) => (
					<Row
						key={e.item.id}
						e={e}
						space={spaceLabel(e.item, me?.households ?? [], t("space.personal"))}
						future={day > today}
						onComplete={() => void enqueueCompletion(e.item.id, day)}
						onUndo={() => void onUndo(e)}
						onEdit={() => setEditing(e.item)}
					/>
				))}
			</View>

			<AddButton label={tab === "habit" ? t("items.newHabit") : t("items.newTask")} onPress={() => setCreating(true)} />
			<ItemSheet kind={tab} visible={creating} onClose={() => setCreating(false)} />
			{editing && <ItemSheet kind={editing.kind} item={editing} visible onClose={() => setEditing(null)} />}
		</Screen>
	);
}
