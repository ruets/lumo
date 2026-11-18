// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError, type CreateItemInput, type CreateRewardInput, type MeResponse } from "@lumo/api-client";
import { t, weekdayShort } from "@lumo/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api } from "../lib/api";
import { describeError, useMe } from "../lib/hooks";
import { Dialog, Field, fieldClass, PrimaryButton } from "./ui";

function useCreate<I>(call: (input: I) => Promise<unknown>, onDone: () => void) {
	const qc = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const m = useMutation({
		mutationFn: call,
		onSuccess: () => {
			void qc.invalidateQueries();
			onDone();
		},
		onError: (err) => setError(err instanceof ApiError ? describeError(err) : t("common.error")),
	});
	return { m, error };
}

/** Who an item or wish is for: the person alone, or one of their households. */
function ScopeField({
	value,
	onChange,
	households,
}: {
	value: string;
	onChange: (v: string) => void;
	households: { id: string; name: string }[];
}) {
	return (
		<Field label={t("form.scope")}>
			<select value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
				{households.map((h) => (
					<option key={h.id} value={h.id}>
						{h.name}
					</option>
				))}
				<option value="personal">{t("form.scope.personal")}</option>
			</select>
		</Field>
	);
}

/** Where a new item or wish goes: `personal` by default without a household, else the active household. */
function useTarget(ward?: { id: string; me: MeResponse }) {
	const mine = useMe().data;
	const me = ward ? ward.me : mine;
	const households = me?.households ?? [];
	const [target, setTarget] = useState<string>(me?.household?.id ?? "personal");
	const scope =
		target === "personal" ? { scope: "personal" as const } : { scope: "household" as const, householdId: target };
	return { households, target, setTarget, scope, personal: target === "personal" };
}

export function ItemDialog({
	kind,
	onClose,
	ward,
}: {
	kind: "habit" | "task";
	onClose: () => void;
	/** A guardian creating for someone they supervise. */
	ward?: { id: string; me: MeResponse };
}) {
	const [freq, setFreq] = useState<"daily" | "timesPerWeek" | "weekly" | "monthly">("daily");
	const [days, setDays] = useState<number[]>([1]);
	const { m, error } = useCreate(
		(input: CreateItemInput) => (ward ? api.createWardItem(ward.id, input) : api.createItem(input)),
		onClose,
	);
	const { households, target, setTarget, scope, personal } = useTarget(ward);

	function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const f = new FormData(e.currentTarget);
		const common = {
			name: String(f.get("name") ?? ""),
			reward: Number(f.get("reward") ?? 0),
			...scope,
			requiresApproval: !personal && f.get("approval") === "on",
		};
		if (kind === "task") {
			const due = String(f.get("dueAt") ?? "");
			m.mutate({ kind: "task", ...common, ...(due ? { dueAt: new Date(`${due}T23:59:00`).toISOString() } : {}) });
			return;
		}
		const count = Number(f.get("count") ?? 1);
		const schedule =
			freq === "daily"
				? ({ type: "daily" } as const)
				: freq === "timesPerWeek"
					? ({ type: "timesPerWeek", count } as const)
					: freq === "weekly"
						? ({ type: "weekly", days } as const)
						: ({ type: "monthly", day: Number(f.get("monthDay") ?? 1) } as const);
		m.mutate({ kind: "habit", ...common, schedule, targetPerPeriod: Number(f.get("target") ?? 1) });
	}

	return (
		<Dialog title={kind === "habit" ? t("items.newHabit") : t("items.newTask")} onClose={onClose}>
			<form onSubmit={submit} className="grid gap-3">
				<Field label={t("form.name")}>
					<input name="name" required maxLength={120} className={fieldClass} />
				</Field>
				{households.length > 0 && <ScopeField value={target} onChange={setTarget} households={households} />}
				<Field label={t("form.reward")}>
					<input name="reward" type="number" min={0} defaultValue={1} className={fieldClass} />
				</Field>
				{kind === "habit" ? (
					<>
						<Field label={t("form.frequency")}>
							<select value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)} className={fieldClass}>
								{(["daily", "timesPerWeek", "weekly", "monthly"] as const).map((f) => (
									<option key={f} value={f}>
										{t(`form.frequency.${f}` as const)}
									</option>
								))}
							</select>
						</Field>
						{freq === "timesPerWeek" && (
							<Field label={t("form.count")}>
								<input name="count" type="number" min={1} max={7} defaultValue={3} className={fieldClass} />
							</Field>
						)}
						{freq === "monthly" && (
							<Field label={t("form.monthDay")}>
								<input name="monthDay" type="number" min={1} max={31} defaultValue={1} className={fieldClass} />
							</Field>
						)}
						{freq === "weekly" && (
							<fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
								<legend className="sr-only">{t("form.frequency.weekly")}</legend>
								{[1, 2, 3, 4, 5, 6, 7].map((iso) => {
									const d = weekdayShort(iso);
									const on = days.includes(iso);
									return (
										<button
											key={d}
											type="button"
											aria-pressed={on}
											onClick={() => setDays(on ? days.filter((x) => x !== iso) : [...days, iso].sort())}
											className={`min-h-11 min-w-11 cursor-pointer rounded-xl border-0 text-sm font-bold ${on ? "bg-primary text-white" : "bg-raised text-soft"}`}
										>
											{d}
										</button>
									);
								})}
							</fieldset>
						)}
						<Field label={t("form.target")}>
							<input name="target" type="number" min={1} max={100} defaultValue={1} className={fieldClass} />
						</Field>
					</>
				) : (
					<Field label={t("form.dueAt")}>
						<input name="dueAt" type="date" className={fieldClass} />
					</Field>
				)}
				{!personal && (
					<label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-soft">
						<input name="approval" type="checkbox" className="size-5" />
						{t("form.requiresApproval")}
					</label>
				)}
				{error && (
					<p role="alert" className="m-0 text-sm font-semibold text-bad">
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="min-h-11 cursor-pointer rounded-full border-0 bg-transparent px-4 font-body text-sm font-bold text-soft"
					>
						{t("common.cancel")}
					</button>
					<PrimaryButton type="submit" disabled={m.isPending || (freq === "weekly" && days.length === 0)}>
						{t("form.save")}
					</PrimaryButton>
				</div>
			</form>
		</Dialog>
	);
}

export function RewardDialog({ onClose, ward }: { onClose: () => void; ward?: { id: string; me: MeResponse } }) {
	const [limited, setLimited] = useState(false);
	const { m, error } = useCreate(
		(input: CreateRewardInput) => (ward ? api.createWardReward(ward.id, input) : api.createReward(input)),
		onClose,
	);
	const { households, target, setTarget, scope } = useTarget(ward);

	function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const f = new FormData(e.currentTarget);
		const link = String(f.get("link") ?? "").trim();
		m.mutate({
			name: String(f.get("name") ?? ""),
			cost: Number(f.get("cost") ?? 1),
			...scope,
			...(link ? { link } : {}),
			...(limited
				? { limitCount: Number(f.get("limitCount") ?? 1), limitPeriod: String(f.get("limitPeriod")) as "week" }
				: {}),
		});
	}

	return (
		<Dialog title={t("wishes.new")} onClose={onClose}>
			<form onSubmit={submit} className="grid gap-3">
				<Field label={t("form.name")}>
					<input name="name" required maxLength={120} className={fieldClass} />
				</Field>
				{households.length > 0 && <ScopeField value={target} onChange={setTarget} households={households} />}
				<Field label={t("form.cost")}>
					<input name="cost" type="number" min={1} defaultValue={50} className={fieldClass} />
				</Field>
				<Field label={t("form.link")}>
					<input name="link" type="url" className={fieldClass} />
				</Field>
				<label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-soft">
					<input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} className="size-5" />
					{t("form.limitCount")}
				</label>
				{limited && (
					<div className="grid grid-cols-2 gap-3">
						<Field label={t("form.limitCount")}>
							<input name="limitCount" type="number" min={1} defaultValue={1} className={fieldClass} />
						</Field>
						<Field label={t("form.limitPeriod")}>
							<select name="limitPeriod" defaultValue="week" className={fieldClass}>
								{(["day", "week", "month", "year"] as const).map((unit) => (
									<option key={unit} value={unit}>
										{t(`form.limitUnit.${unit}` as const)}
									</option>
								))}
							</select>
						</Field>
					</div>
				)}
				{error && (
					<p role="alert" className="m-0 text-sm font-semibold text-bad">
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="min-h-11 cursor-pointer rounded-full border-0 bg-transparent px-4 font-body text-sm font-bold text-soft"
					>
						{t("common.cancel")}
					</button>
					<PrimaryButton type="submit" disabled={m.isPending}>
						{t("form.save")}
					</PrimaryButton>
				</div>
			</form>
		</Dialog>
	);
}
