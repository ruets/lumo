// SPDX-License-Identifier: AGPL-3.0-or-later
import { inSpace, type MeResponse, type RewardList, spaceLabel } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { useState } from "react";
import { RewardDialog } from "../components/forms";
import { withSpace } from "../components/itemMeta";
import { SpacePills } from "../components/SpacePills";
import { AddButton, Bar, CoinIcon, PageTitle } from "../components/ui";
import { useRedeem, useRewards, useToday } from "../lib/hooks";
import { useSpaceFilter } from "../lib/space";

type Reward = RewardList[number];

function meta(r: Reward): string {
	if (r.limitCount === null || r.limitPeriod === null)
		return r.link ? r.link.replace(/^https?:\/\//, "") : t("wishes.unlimited");
	const period = t(`wishes.period.${r.limitPeriod}` as const);
	return (r.remaining ?? 0) > 0
		? t("wishes.limitLeft", { count: r.remaining ?? 0, period })
		: t("wishes.limitNone", { period });
}

export function WishesPage({ me }: { me: MeResponse }) {
	const rewards = useRewards();
	const redeem = useRedeem();
	const today = useToday();
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<Reward | null>(null);
	const filter = useSpaceFilter(me.households);
	const [last, setLast] = useState<Reward | null>(null);
	const balance = me.wallets.personal.balance;
	const shown = (rewards.data?.rewards ?? []).filter((r) => inSpace(filter, r));
	const earnedToday = (today.data?.items ?? []).reduce((s, e) => s + e.item.reward * e.approved, 0);

	return (
		<div className="grid gap-5">
			<PageTitle>{t("wishes.title")}</PageTitle>

			<section className="flex items-center justify-between rounded-[26px] bg-primary p-5 text-white">
				<div className="grid gap-1.5">
					<p className="m-0 text-[13px] font-bold uppercase tracking-widest">{t("wishes.balance")}</p>
					<p className="m-0 flex items-center gap-2.5 font-display text-[34px] font-bold">
						<CoinIcon size={30} />
						{balance}
					</p>
					<p aria-live="polite" className="m-0 text-sm font-semibold">
						{last
							? t("wishes.redeemed", { name: last.name, cost: last.cost })
							: t("today.earned", { count: earnedToday })}
					</p>
				</div>
				{me.wallets.shared && (
					<p className="m-0 text-sm font-semibold">
						{t("wishes.sharedBalance", { amount: me.wallets.shared.balance })}
					</p>
				)}
			</section>

			<SpacePills households={me.households} value={filter} />

			{shown.length === 0 && <p className="m-0 text-muted">{t("wishes.empty")}</p>}
			<ul className="m-0 grid list-none gap-2.5 p-0 md:grid-cols-2">
				{shown.map((r) => {
					const wallet = r.fundedFrom === "shared" ? (me.wallets.shared?.balance ?? 0) : balance;
					const exhausted = r.limitCount !== null && (r.remaining ?? 0) <= 0;
					const canBuy = wallet >= r.cost && !exhausted;
					return (
						<li key={r.id} className="grid gap-2.5 rounded-[20px] bg-surface px-4 py-3.5">
							<div className="flex items-center justify-between gap-3">
								<span className="grid gap-[3px]">
									<span className="text-base font-bold">{r.name}</span>
									<span className="text-[13px] text-muted">
										{withSpace(spaceLabel(r, me.households, t("space.personal")), meta(r))}
									</span>
								</span>
								<div className="flex shrink-0 items-center gap-1">
									<button
										type="button"
										aria-label={t("wishes.editLabel", { name: r.name })}
										onClick={() => setEditing(r)}
										className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-raised hover:text-ink"
									>
										<svg
											aria-hidden="true"
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<path d="M12 20h9" />
											<path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
										</svg>
									</button>
									{canBuy ? (
										<button
											type="button"
											aria-label={t("wishes.redeem", { name: r.name, count: r.cost })}
											disabled={redeem.isPending}
											onClick={() => redeem.mutate(r.id, { onSuccess: () => setLast(r) })}
											className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-coin px-4 font-body text-sm font-bold text-bg"
										>
											<CoinIcon size={16} />
											{r.cost}
										</button>
									) : (
										<span className="flex shrink-0 items-center gap-1.5 px-1 text-sm font-bold text-soft">
											<CoinIcon size={16} />
											{r.cost}
										</span>
									)}
								</div>
							</div>
							{!canBuy && (
								<div className="grid gap-1.5">
									<Bar pct={exhausted ? 100 : (100 * wallet) / r.cost} color="bg-primary-soft" />
									<span className="text-[13px] text-muted">
										{exhausted ? t("wishes.comesBack") : t("today.missing", { count: r.cost - wallet })}
									</span>
								</div>
							)}
						</li>
					);
				})}
			</ul>

			<AddButton label={t("wishes.new")} onClick={() => setCreating(true)} />
			{creating && <RewardDialog onClose={() => setCreating(false)} />}
			{editing && <RewardDialog reward={editing} onClose={() => setEditing(null)} />}
		</div>
	);
}
