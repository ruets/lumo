// SPDX-License-Identifier: AGPL-3.0-or-later
import { inSpace, type MeResponse, spaceLabel, type TodayItem } from "@lumo/api-client";
import { longDate, t } from "@lumo/i18n";
import { Link } from "@tanstack/react-router";
import { HeaderActions } from "../components/AppShell";
import { awaitingReview, itemMeta, withSpace } from "../components/itemMeta";
import { SpacePills } from "../components/SpacePills";
import { Bar, CoinIcon, PageTitle, Reward, Ring } from "../components/ui";
import {
	statsWindow,
	useComplete,
	useItems,
	useMe,
	usePending,
	useReview,
	useRewards,
	useStats,
	useToday,
} from "../lib/hooks";
import { useSpaceFilter } from "../lib/space";

function RemainingRow({ e, space, onTap }: { e: TodayItem; space: string | null; onTap: () => void }) {
	const waiting = awaitingReview(e);
	const multi = e.target > 1;
	return (
		<button
			type="button"
			disabled={waiting}
			onClick={onTap}
			aria-label={
				multi
					? t("items.validateCount", { name: e.item.name, current: e.approved, target: e.target, count: e.item.reward })
					: t("items.validate", { name: e.item.name, count: e.item.reward })
			}
			className="flex min-h-[60px] w-full cursor-pointer items-center gap-3.5 rounded-[18px] border-0 bg-surface px-4 py-2.5 text-left font-body text-ink hover:bg-raised disabled:cursor-default disabled:opacity-70 disabled:hover:bg-surface"
		>
			<span
				aria-hidden="true"
				className="flex size-[34px] shrink-0 items-center justify-center rounded-full border-2 border-primary-soft text-[11px] font-bold text-soft"
			>
				{multi ? `${e.approved}/${e.target}` : ""}
			</span>
			<span className="flex grow flex-col gap-0.5">
				<span className="text-[15px] font-bold">{e.item.name}</span>
				<span className="text-[13px] text-muted">{withSpace(space, itemMeta(e))}</span>
			</span>
			<Reward amount={e.item.reward} />
		</button>
	);
}

function Approvals() {
	const me = useMe().data;
	const pending = usePending(Boolean(me?.household));
	const items = useItems();
	const review = useReview();
	const list = pending.data?.completions ?? [];
	if (list.length === 0) return null;
	const name = (id: string) => items.data?.items.find((i) => i.id === id)?.name ?? "…";
	return (
		<section className="grid gap-2.5">
			<h2 className="m-0 text-[15px] font-bold text-muted">{t("today.approvals")}</h2>
			{list.map((c) => (
				<div key={c.id} className="flex items-center gap-3 rounded-[18px] bg-surface p-3 pl-4">
					<span className="grow text-[15px] font-bold">{name(c.itemId)}</span>
					<button
						type="button"
						onClick={() => review.mutate({ id: c.id, approve: false })}
						className="min-h-11 cursor-pointer rounded-full border border-edge bg-transparent px-4 text-sm font-bold text-soft"
					>
						{t("today.reject")}
					</button>
					<button
						type="button"
						onClick={() => review.mutate({ id: c.id, approve: true })}
						className="min-h-11 cursor-pointer rounded-full border-0 bg-ok px-4 text-sm font-bold text-bg"
					>
						{t("today.approve")}
					</button>
				</div>
			))}
		</section>
	);
}

export function TodayPage({ me }: { me: MeResponse }) {
	const today = useToday();
	const complete = useComplete();
	const rewards = useRewards();
	const filter = useSpaceFilter(me.households);
	const win = today.data ? statsWindow(today.data.date) : undefined;
	const stats = useStats(win?.from, win?.to);

	if (today.isPending) return <p className="text-muted">{t("common.loading")}</p>;
	if (today.isError) return <p role="alert">{t("common.error")}</p>;

	const entries = today.data.items.filter((e) => inSpace(filter, e.item));
	const done = entries.filter((e) => e.done).length;
	const pct = entries.length ? Math.round((100 * done) / entries.length) : 0;
	const earned = entries.reduce((s, e) => s + e.item.reward * e.approved, 0);
	const remaining = entries.filter((e) => !e.done);
	const streak = Math.max(0, ...(stats.data?.habits.map((h) => h.streak.current) ?? []));
	const balance = me.wallets.personal.balance;
	const personal = rewards.data?.rewards.filter((r) => r.fundedFrom === "personal" && inSpace(filter, r)) ?? [];
	const wish = personal.find((r) => r.cost > balance) ?? personal[0];

	return (
		<div className="grid gap-6">
			<header className="flex items-center justify-between">
				<div className="grid gap-1.5">
					<p className="m-0 text-sm font-semibold text-muted">{longDate(today.data.date)}</p>
					<PageTitle>{t("today.title", { name: me.user.displayName })}</PageTitle>
				</div>
				<HeaderActions balance={me.wallets.personal.balance} name={me.user.displayName} />
			</header>

			<div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
				<div className="grid gap-6">
					<section className="flex items-center gap-5 rounded-[28px] bg-primary p-[22px] text-white">
						<Ring pct={pct} label={t("today.ringLabel", { pct })} />
						<div className="grid gap-1.5">
							<p className="m-0 text-[13px] font-bold uppercase tracking-widest">{t("today.yourDay")}</p>
							<p className="m-0 font-display text-[19px] font-medium leading-tight">
								{t("today.doneOf", { done, total: entries.length })}
							</p>
							<p className="m-0 text-sm font-semibold">
								{t("today.earned", { count: earned })}
								{streak > 1 && ` · ${t("today.streak", { count: streak })}`}
							</p>
						</div>
					</section>

					<SpacePills households={me.households} value={filter} />

					{me.role !== "child" && <Approvals />}

					<section className="grid gap-2.5">
						<h2 className="m-0 text-[15px] font-bold text-muted">{t("today.remaining")}</h2>
						{remaining.length === 0 && (
							<p className="m-0 rounded-[18px] bg-surface p-[18px] text-[15px] font-semibold text-ok">
								{t("today.allDone")}
							</p>
						)}
						{remaining.map((e) => (
							<RemainingRow
								key={e.item.id}
								e={e}
								space={spaceLabel(e.item, me.households, t("space.personal"))}
								onTap={() => complete.mutate(e.item.id)}
							/>
						))}
					</section>
				</div>

				{wish && (
					<Link
						to="/wishes"
						className="grid gap-2.5 rounded-[22px] bg-surface p-[18px] text-ink no-underline hover:bg-raised"
					>
						<span className="flex items-baseline justify-between">
							<span className="text-[13px] font-bold text-muted">{t("today.nextWish")}</span>
							<span className="flex items-center gap-1 text-[13px] font-bold text-coin">
								<CoinIcon size={13} />
								{Math.min(balance, wish.cost)} / {wish.cost}
							</span>
						</span>
						<span className="text-base font-bold">{wish.name}</span>
						<Bar pct={(100 * balance) / wish.cost} />
						<span className="text-[13px] text-muted">
							{balance >= wish.cost ? t("today.canAfford") : t("today.missing", { count: wish.cost - balance })}
						</span>
					</Link>
				)}
			</div>
		</div>
	);
}
