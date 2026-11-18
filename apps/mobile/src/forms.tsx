// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CreateItemInput, Item, MeResponse, UpdateItemInput } from "@lumo/api-client";
import { t, weekdayShort } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Switch, View } from "react-native";
import { describeError, useMe, useSupervision } from "./hooks";
import { api } from "./session";
import { Button, Chip, Field, font, Sheet, T } from "./ui";

type Freq = "daily" | "timesPerWeek" | "weekly" | "monthly";
const FREQS: Freq[] = ["daily", "timesPerWeek", "weekly", "monthly"];

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

/** Who an item or wish is for: one of the person's households, or the person alone. */
function ScopeChips({
	dest,
	onChange,
	households,
}: {
	dest: string;
	onChange: (target: string) => void;
	households: { id: string; name: string }[];
}) {
	return (
		<>
			<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.muted }}>{t("form.scope")}</T>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				{households.map((h) => (
					<Chip key={h.id} label={h.name} on={dest === h.id} onPress={() => onChange(h.id)} />
				))}
				<Chip label={t("form.scope.personal")} on={dest === "personal"} onPress={() => onChange("personal")} />
			</View>
		</>
	);
}

/** Where a new item or wish goes: personal without a household, else the active household. */
function useTarget(ward?: { id: string; me: MeResponse }) {
	const mine = useMe().data;
	const me = ward ? ward.me : mine;
	const households = me?.households ?? [];
	const [dest, setDest] = useState<string>(me?.household?.id ?? "personal");
	const personal = dest === "personal";
	const scope = personal ? { scope: "personal" as const } : { scope: "household" as const, householdId: dest };
	return { households, dest, setDest, scope, personal };
}

export function ItemSheet({
	kind,
	visible,
	onClose,
	ward,
	item,
}: {
	kind: "habit" | "task";
	visible: boolean;
	onClose: () => void;
	/** A guardian creating for someone they supervise. */
	ward?: { id: string; me: MeResponse };
	/** Set to edit this item instead of creating one (its space cannot change). */
	item?: Item;
}) {
	const sched = item?.schedule ?? null;
	const [name, setName] = useState(item?.name ?? "");
	const [reward, setReward] = useState(String(item?.reward ?? 1));
	const [freq, setFreq] = useState<Freq>(sched?.type ?? "daily");
	const [count, setCount] = useState(String(sched?.type === "timesPerWeek" ? sched.count : 3));
	const [monthDay, setMonthDay] = useState(String(sched?.type === "monthly" ? sched.day : 1));
	const [days, setDays] = useState<number[]>(sched?.type === "weekly" ? sched.days : [1]);
	const [target, setTarget] = useState(String(item?.targetPerPeriod ?? 1));
	const [approval, setApproval] = useState(item?.requiresApproval ?? false);
	const { households, dest, setDest, scope, personal: createPersonal } = useTarget(ward);
	const personal = item ? item.scope === "personal" : createPersonal;
	// Approval only concerns a supervised person: the one the item is for (a ward, or me if I have guardians).
	const supervision = useSupervision().data;
	const canAsk = Boolean(ward) || (supervision?.guardians.length ?? 0) > 0;
	const created = useSubmit(
		(i: CreateItemInput) => (ward ? api.createWardItem(ward.id, i) : api.createItem(i)),
		() => {
			setName("");
			onClose();
		},
	);
	const edited = useSubmit((i: UpdateItemInput) => api.updateItem(item?.id ?? "", i), onClose);
	const { m, error } = item ? edited : created;

	function submit() {
		const common = {
			name: name.trim(),
			reward: Number(reward) || 0,
			requiresApproval: personal ? false : canAsk ? approval : (item?.requiresApproval ?? false),
		};
		if (kind === "task")
			return item ? edited.m.mutate(common) : created.m.mutate({ kind: "task", ...common, ...scope });
		const schedule =
			freq === "daily"
				? ({ type: "daily" } as const)
				: freq === "timesPerWeek"
					? ({ type: "timesPerWeek", count: Number(count) || 1 } as const)
					: freq === "weekly"
						? ({ type: "weekly", days } as const)
						: ({ type: "monthly", day: Number(monthDay) || 1 } as const);
		const targetPerPeriod = Number(target) || 1;
		if (item) return edited.m.mutate({ ...common, schedule, targetPerPeriod });
		created.m.mutate({ kind: "habit", ...common, ...scope, schedule, targetPerPeriod });
	}

	return (
		<Sheet
			title={
				item
					? kind === "habit"
						? t("items.editHabit")
						: t("items.editTask")
					: kind === "habit"
						? t("items.newHabit")
						: t("items.newTask")
			}
			visible={visible}
			onClose={onClose}
		>
			<Field label={t("form.name")} value={name} onChangeText={setName} maxLength={120} />
			{!item && households.length > 0 && <ScopeChips dest={dest} onChange={setDest} households={households} />}
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
							{[1, 2, 3, 4, 5, 6, 7].map((iso) => (
								<Chip
									key={iso}
									label={weekdayShort(iso)}
									on={days.includes(iso)}
									onPress={() => setDays(days.includes(iso) ? days.filter((x) => x !== iso) : [...days, iso].sort())}
								/>
							))}
						</View>
					)}
					<Field label={t("form.target")} value={target} onChangeText={setTarget} keyboardType="number-pad" />
				</>
			)}
			{!personal && canAsk && (
				<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
					<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.textSoft, flex: 1 }}>
						{t("form.requiresApproval")}
					</T>
					<Switch value={approval} onValueChange={setApproval} trackColor={{ true: colors.primary }} />
				</View>
			)}
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

export function RewardSheet({
	visible,
	onClose,
	ward,
}: {
	visible: boolean;
	onClose: () => void;
	ward?: { id: string; me: MeResponse };
}) {
	const [name, setName] = useState("");
	const [cost, setCost] = useState("50");
	const [link, setLink] = useState("");
	const [limited, setLimited] = useState(false);
	const [limitCount, setLimitCount] = useState("1");
	const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("week");
	const { households, dest, setDest, scope } = useTarget(ward);
	const { m, error } = useSubmit(
		(i: Parameters<typeof api.createReward>[0]) => (ward ? api.createWardReward(ward.id, i) : api.createReward(i)),
		() => {
			setName("");
			onClose();
		},
	);

	return (
		<Sheet title={t("wishes.new")} visible={visible} onClose={onClose}>
			<Field label={t("form.name")} value={name} onChangeText={setName} maxLength={120} />
			{households.length > 0 && <ScopeChips dest={dest} onChange={setDest} households={households} />}
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
							<Chip key={p} label={t(`form.limitUnit.${p}` as const)} on={period === p} onPress={() => setPeriod(p)} />
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
							...scope,
							...(link.trim() ? { link: link.trim() } : {}),
							...(limited ? { limitCount: Number(limitCount) || 1, limitPeriod: period } : {}),
						})
					}
				/>
			</View>
		</Sheet>
	);
}
