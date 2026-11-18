// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ItemDialog, RewardDialog } from "../components/forms";
import { AddButton, Field, fieldClass, PageTitle, PrimaryButton, useConfirm } from "../components/ui";
import { api } from "../lib/api";
import {
	useSupervision,
	useSupervisionWrite,
	useWardItems,
	useWardMe,
	useWardPending,
	useWardRewards,
} from "../lib/hooks";
import { showToast } from "../lib/toast";
import { Section } from "./Supervision";

const RIGHTS = ["canCreate", "canModify", "canDelete", "canTransfer"] as const;
const ghost =
	"min-h-11 cursor-pointer rounded-full border border-edge bg-transparent px-4 font-body text-sm font-bold text-soft hover:bg-raised";

/** A guardian's view of one ward: rights, coins, approvals, and the ward's own habits, tasks and wishes. */
export function WardPanel({ wardId }: { wardId: string }) {
	const navigate = useNavigate();
	const supervision = useSupervision();
	const ward = supervision.data?.wards.find((w) => w.id === wardId);
	const me = useWardMe(wardId);
	const items = useWardItems(wardId);
	const rewards = useWardRewards(wardId);
	const pending = useWardPending(wardId);
	const [adding, setAdding] = useState<"habit" | "task" | "wish" | null>(null);
	const setRight = useSupervisionWrite((input: Partial<Record<(typeof RIGHTS)[number], boolean>>) =>
		api.updateWardRights(wardId, input),
	);
	const review = useSupervisionWrite(({ id, approve }: { id: string; approve: boolean }) =>
		api.reviewWardCompletion(wardId, id, approve),
	);
	const adjust = useSupervisionWrite((input: { amount: number; note: string }) => api.adjustWardCoins(wardId, input));
	const archive = useSupervisionWrite((id: string) => api.archiveWardItem(wardId, id));
	const confirm = useConfirm();
	const end = useSupervisionWrite(() => api.endSupervision(wardId));

	if (!ward) return <p className="text-muted">{t("common.loading")}</p>;

	function submitAdjust(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const f = new FormData(form);
		adjust.mutate(
			{ amount: Number(f.get("amount")), note: String(f.get("note") ?? "").trim() },
			{
				onSuccess: () => {
					form.reset();
					showToast(t("admin.saved"), 1500);
				},
			},
		);
	}

	return (
		<div className="grid max-w-xl gap-5">
			<PageTitle>{ward.displayName}</PageTitle>

			<Section title={t("supervision.rights")}>
				{RIGHTS.map((r) => (
					<label key={r} className="flex min-h-11 items-center gap-2 text-sm font-semibold text-soft">
						<input
							type="checkbox"
							checked={ward.rights[r]}
							onChange={(e) => setRight.mutate({ [r]: e.target.checked })}
							className="size-5"
						/>
						{t(`supervision.right.${r}` as const)}
					</label>
				))}
			</Section>

			<Section title={t("supervision.ward.adjust")}>
				{me.data && (
					<p className="m-0 text-sm font-bold text-coin">
						{t("supervision.ward.balance", { amount: me.data.wallets.personal.balance })}
					</p>
				)}
				<form onSubmit={submitAdjust} className="grid gap-3">
					<Field label={t("admin.pot.amount")}>
						<input name="amount" type="number" step={1} required className={fieldClass} />
					</Field>
					<Field label={t("admin.pot.note")}>
						<input name="note" required maxLength={500} className={fieldClass} />
					</Field>
					<PrimaryButton type="submit" disabled={adjust.isPending}>
						{t("supervision.ward.adjust")}
					</PrimaryButton>
				</form>
			</Section>

			{(pending.data?.completions.length ?? 0) > 0 && (
				<Section title={t("supervision.ward.pending")}>
					{pending.data?.completions.map((c) => (
						<div key={c.id} className="flex items-center gap-2">
							<span className="grow text-[15px] font-bold">{c.itemName}</span>
							<button type="button" className={ghost} onClick={() => review.mutate({ id: c.id, approve: false })}>
								{t("today.reject")}
							</button>
							<PrimaryButton onClick={() => review.mutate({ id: c.id, approve: true })}>
								{t("today.approve")}
							</PrimaryButton>
						</div>
					))}
				</Section>
			)}

			<Section title={t("supervision.ward.items")}>
				{items.data?.items.length === 0 && <p className="m-0 text-sm text-muted">{t("items.empty")}</p>}
				{items.data?.items.map((i) => (
					<div key={i.id} className="flex items-center gap-2">
						<span className="grow text-[15px] font-bold">{i.name}</span>
						<button type="button" className={ghost} onClick={() => archive.mutate(i.id)}>
							{t("supervision.ward.archive")}
						</button>
					</div>
				))}
				<div className="flex flex-wrap gap-2">
					<button type="button" className={ghost} onClick={() => setAdding("habit")}>
						{t("items.newHabit")}
					</button>
					<button type="button" className={ghost} onClick={() => setAdding("task")}>
						{t("items.newTask")}
					</button>
				</div>
			</Section>

			<Section title={t("supervision.ward.wishes")}>
				{rewards.data?.rewards.length === 0 && <p className="m-0 text-sm text-muted">{t("wishes.empty")}</p>}
				{rewards.data?.rewards.map((r) => (
					<p key={r.id} className="m-0 text-[15px] font-bold">
						{r.name} · {r.cost}
					</p>
				))}
				<AddButton label={t("supervision.ward.addWish")} onClick={() => setAdding("wish")} />
			</Section>

			<button
				type="button"
				className={`${ghost} text-bad`}
				onClick={() => {
					confirm.ask(t("supervision.endConfirm", { name: ward.displayName }), t("supervision.end"), () =>
						end.mutate(undefined, { onSuccess: () => void navigate({ to: "/supervision" }) }),
					);
				}}
			>
				{t("supervision.end")}
			</button>
			{confirm.dialog}

			{me.data && (adding === "habit" || adding === "task") && (
				<ItemDialog kind={adding} ward={{ id: wardId, me: me.data }} onClose={() => setAdding(null)} />
			)}
			{me.data && adding === "wish" && (
				<RewardDialog ward={{ id: wardId, me: me.data }} onClose={() => setAdding(null)} />
			)}
		</div>
	);
}
