// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CreateItemInput } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { describeError } from "./hooks";
import { api } from "./session";
import { Button, Field, font, Sheet, T } from "./ui";

type Freq = "daily" | "timesPerWeek" | "weekly" | "monthly";
const FREQS: Freq[] = ["daily", "timesPerWeek", "weekly", "monthly"];
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: on }}
			onPress={onPress}
			style={{
				minHeight: 44,
				minWidth: 44,
				paddingHorizontal: 12,
				borderRadius: 12,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: on ? colors.primary : colors.surfaceRaised,
			}}
		>
			<T style={{ fontFamily: font.bold, fontSize: 14, color: on ? "#fff" : colors.textSoft }}>{label}</T>
		</Pressable>
	);
}

function useSubmit<I>(call: (i: I) => Promise<unknown>, onClose: () => void) {
	const qc = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const m = useMutation({
		mutationFn: call,
		onSuccess: () => {
			void qc.invalidateQueries();
			onClose();
		},
		onError: (err) => setError(describeError(err)),
	});
	return { m, error };
}

export function ItemSheet({
	kind,
	visible,
	onClose,
}: {
	kind: "habit" | "task";
	visible: boolean;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [reward, setReward] = useState("1");
	const [freq, setFreq] = useState<Freq>("daily");
	const [count, setCount] = useState("3");
	const [monthDay, setMonthDay] = useState("1");
	const [days, setDays] = useState<number[]>([1]);
	const [target, setTarget] = useState("1");
	const [approval, setApproval] = useState(false);
	const { m, error } = useSubmit(
		(i: CreateItemInput) => api.createItem(i),
		() => {
			setName("");
			onClose();
		},
	);

	function submit() {
		const common = { name: name.trim(), reward: Number(reward) || 0, requiresApproval: approval };
		if (kind === "task") return m.mutate({ kind: "task", ...common });
		const schedule =
			freq === "daily"
				? ({ type: "daily" } as const)
				: freq === "timesPerWeek"
					? ({ type: "timesPerWeek", count: Number(count) || 1 } as const)
					: freq === "weekly"
						? ({ type: "weekly", days } as const)
						: ({ type: "monthly", day: Number(monthDay) || 1 } as const);
		m.mutate({ kind: "habit", ...common, schedule, targetPerPeriod: Number(target) || 1 });
	}

	return (
		<Sheet title={kind === "habit" ? t("items.newHabit") : t("items.newTask")} visible={visible} onClose={onClose}>
			<Field label={t("form.name")} value={name} onChangeText={setName} maxLength={120} />
			<Field label={t("form.reward")} value={reward} onChangeText={setReward} keyboardType="number-pad" />
			{kind === "habit" && (
				<>
					<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.muted }}>{t("form.frequency")}</T>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
						{FREQS.map((f) => (
							<Chip key={f} label={t(`form.frequency.${f}` as const)} on={freq === f} onPress={() => setFreq(f)} />
						))}
					</View>
					{freq === "timesPerWeek" && (
						<Field label={t("form.count")} value={count} onChangeText={setCount} keyboardType="number-pad" />
					)}
					{freq === "monthly" && (
						<Field label={t("form.monthDay")} value={monthDay} onChangeText={setMonthDay} keyboardType="number-pad" />
					)}
					{freq === "weekly" && (
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
							{WEEKDAYS.map((d, i) => (
								<Chip
									key={d}
									label={d}
									on={days.includes(i + 1)}
									onPress={() =>
										setDays(days.includes(i + 1) ? days.filter((x) => x !== i + 1) : [...days, i + 1].sort())
									}
								/>
							))}
						</View>
					)}
					<Field label={t("form.target")} value={target} onChangeText={setTarget} keyboardType="number-pad" />
				</>
			)}
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
				<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.textSoft, flex: 1 }}>
					{t("form.requiresApproval")}
				</T>
				<Switch value={approval} onValueChange={setApproval} trackColor={{ true: colors.primary }} />
			</View>
			{error && <T style={{ color: colors.danger, fontFamily: font.semi }}>{error}</T>}
			<View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
				<Button label={t("common.cancel")} variant="ghost" onPress={onClose} />
				<Button
					label={t("form.save")}
					disabled={m.isPending || name.trim() === "" || (freq === "weekly" && days.length === 0)}
					onPress={submit}
				/>
			</View>
		</Sheet>
	);
}

export function RewardSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
	const [name, setName] = useState("");
	const [cost, setCost] = useState("50");
	const [link, setLink] = useState("");
	const [limited, setLimited] = useState(false);
	const [limitCount, setLimitCount] = useState("1");
	const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("week");
	const { m, error } = useSubmit(
		(i: Parameters<typeof api.createReward>[0]) => api.createReward(i),
		() => {
			setName("");
			onClose();
		},
	);

	return (
		<Sheet title={t("wishes.new")} visible={visible} onClose={onClose}>
			<Field label={t("form.name")} value={name} onChangeText={setName} maxLength={120} />
			<Field label={t("form.cost")} value={cost} onChangeText={setCost} keyboardType="number-pad" />
			<Field label={t("form.link")} value={link} onChangeText={setLink} autoCapitalize="none" keyboardType="url" />
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
				<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.textSoft, flex: 1 }}>{t("form.limitCount")}</T>
				<Switch value={limited} onValueChange={setLimited} trackColor={{ true: colors.primary }} />
			</View>
			{limited && (
				<>
					<Field
						label={t("form.limitCount")}
						value={limitCount}
						onChangeText={setLimitCount}
						keyboardType="number-pad"
					/>
					<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
						{(["day", "week", "month", "year"] as const).map((p) => (
							<Chip
								key={p}
								label={{ day: "jour", week: "semaine", month: "mois", year: "an" }[p]}
								on={period === p}
								onPress={() => setPeriod(p)}
							/>
						))}
					</View>
				</>
			)}
			{error && <T style={{ color: colors.danger, fontFamily: font.semi }}>{error}</T>}
			<View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
				<Button label={t("common.cancel")} variant="ghost" onPress={onClose} />
				<Button
					label={t("form.save")}
					disabled={m.isPending || name.trim() === ""}
					onPress={() =>
						m.mutate({
							name: name.trim(),
							cost: Number(cost) || 1,
							...(link.trim() ? { link: link.trim() } : {}),
							...(limited ? { limitCount: Number(limitCount) || 1, limitPeriod: period } : {}),
						})
					}
				/>
			</View>
		</Sheet>
	);
}
