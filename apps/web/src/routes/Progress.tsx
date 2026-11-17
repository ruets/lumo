// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LedgerEntry, MeResponse } from "@lumo/api-client";
import { type ProgressPeriod, summarizeProgress } from "@lumo/domain";
import { dayNumber, shortDate, t, weekdayShort } from "@lumo/i18n";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageTitle, Segmented } from "../components/ui";
import { statsWindow, useLedger, useStats, useToday, useUndoRedemption } from "../lib/hooks";
import { showToast } from "../lib/toast";

function entryLabel(e: LedgerEntry): string {
	if (e.label) {
		if (e.reason !== "undo") return e.label;
		// Le remboursement d'un échange est positif ; l'annulation d'une validation est négative.
		return `${e.amount > 0 ? t("ledger.undoRedemption") : t("ledger.undo")} · ${e.label}`;
	}
	if (e.note) return e.note;
	return t(`ledger.${e.reason}` as const);
}

const when = (iso: string) => shortDate(iso.slice(0, 10));

export function ProgressPage({ me }: { me: MeResponse }) {
	const [period, setPeriod] = useState<ProgressPeriod>("week");
	const now = useToday();
	const win = now.data ? statsWindow(now.data.date) : undefined;
	const stats = useStats(win?.from, win?.to);
	const ledger = useLedger();
	const undoRedemption = useUndoRedemption();

	if (!now.data || !stats.data) return <p className="text-muted">{t("common.loading")}</p>;

	const s = summarizeProgress(stats.data.heatmap, now.data.date, period);
	const maxExpected = Math.max(1, ...s.bars.map((b) => b.expected));
	const streak = Math.max(0, ...stats.data.habits.map((h) => h.streak.current));
	const entries = ledger.data?.entries ?? [];
	// Un échange est annulable tant qu'aucun remboursement ne le référence (le remboursement est plus récent, donc listé).
	const refunded = new Set(entries.filter((e) => e.reason === "undo" && e.amount > 0).map((e) => e.refId));
	const cancel = (e: LedgerEntry) => {
		if (!e.refId || !window.confirm(t("ledger.undoConfirm", { amount: Math.abs(e.amount) }))) return;
		undoRedemption.mutate(e.refId, { onSuccess: () => showToast(t("ledger.undone", { amount: Math.abs(e.amount) })) });
	};
	const earned = entries
		.filter((e) => e.createdAt.slice(0, 10) >= s.from && e.createdAt.slice(0, 10) <= s.to)
		.reduce((sum, e) => (e.reason === "completion" || e.reason === "undo" ? sum + e.amount : sum), 0);

	return (
		<div className="grid gap-5">
			<header className="flex items-center justify-between gap-4">
				<PageTitle>{t("progress.title")}</PageTitle>
				<Segmented
					label="Période"
					value={period}
					onChange={setPeriod}
					options={[
						{ id: "week", label: t("progress.week") },
						{ id: "month", label: t("progress.month") },
					]}
				/>
			</header>

			<div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
				<section className="grid gap-4 rounded-[26px] bg-surface p-5">
					<div className="flex items-end justify-between">
						<div className="grid gap-1">
							<p className="m-0 text-sm font-semibold text-muted">
								{period === "week" ? t("progress.weekCaption") : t("progress.monthCaption")}
							</p>
							<p className="m-0 font-display text-[34px] font-bold">
								{s.rate === null ? t("progress.noRate") : `${s.rate} %`}
							</p>
						</div>
						{s.trend !== null && (
							<p className={`m-0 text-sm font-bold ${s.trend >= 0 ? "text-ok" : "text-bad"}`}>
								{t("progress.trend", { sign: s.trend >= 0 ? "+" : "−", pts: Math.abs(s.trend) })}
							</p>
						)}
					</div>
					<div
						role="img"
						aria-label={`${s.done} sur ${s.expected} validées, ${s.rate ?? 0} %`}
						className="flex h-40 items-end gap-2.5"
					>
						{s.bars.map((b) => (
							<div key={b.from} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
								<div
									className={`w-full max-w-9 rounded-[10px] ${b.current ? "bg-ok" : b.future ? "bg-raised" : "bg-primary-soft"}`}
									style={{ height: `${b.future ? 4 : Math.max(4, Math.round((100 * b.done) / maxExpected))}%` }}
								/>
								<span className="text-xs font-semibold text-muted">
									{period === "week"
										? weekdayShort(((new Date(`${b.from}T00:00:00Z`).getUTCDay() + 6) % 7) + 1).charAt(0)
										: dayNumber(b.from)}
								</span>
							</div>
						))}
					</div>
				</section>

				<div className="grid grid-cols-3 gap-2.5">
					{[
						[t("progress.done"), String(s.done)],
						[t("progress.earned"), String(earned)],
						[t("progress.streak"), t("progress.days", { days: streak })],
					].map(([label, value]) => (
						<div key={label} className="grid gap-1.5 rounded-[20px] bg-surface p-3.5">
							<p className="m-0 text-xs font-semibold text-muted">{label}</p>
							<p className="m-0 font-display text-xl font-bold">{value}</p>
						</div>
					))}
				</div>
			</div>

			<section className="grid gap-2.5">
				<div className="flex items-center justify-between">
					<h2 className="m-0 text-[15px] font-bold text-muted">{t("progress.lastCoins")}</h2>
					<Link to="/envies" className="py-2.5 text-sm font-bold text-link no-underline">
						{t("progress.balance", { amount: me.wallets.personal.balance })}
					</Link>
				</div>
				<ul className="m-0 list-none rounded-[20px] bg-surface px-4 py-0">
					{entries.slice(0, 8).map((e, i, arr) => (
						<li
							key={e.id}
							className={`flex min-h-[58px] items-center justify-between gap-3 ${i < arr.length - 1 ? "border-b border-line" : ""}`}
						>
							<span className="grid gap-0.5">
								<span className="text-[15px] font-semibold">{entryLabel(e)}</span>
								<span className="text-xs text-muted">{when(e.createdAt)}</span>
							</span>
							<span className="flex items-center gap-3">
								{e.reason === "redemption" && e.refId && !refunded.has(e.refId) && (
									<button
										type="button"
										aria-label={t("ledger.undoActionFor", { name: e.label ?? "" })}
										disabled={undoRedemption.isPending}
										onClick={() => cancel(e)}
										className="min-h-11 cursor-pointer rounded-full border border-edge bg-transparent px-3 font-body text-xs font-bold text-soft hover:bg-raised"
									>
										{t("ledger.undoAction")}
									</button>
								)}
								{e.reason === "redemption" && e.refId && refunded.has(e.refId) && (
									<span className="text-xs font-semibold text-muted">{t("ledger.refunded")}</span>
								)}
								<span className={`font-display text-[15px] font-bold ${e.amount > 0 ? "text-coin" : "text-soft"}`}>
									{e.amount > 0 ? "+" : "−"}
									{Math.abs(e.amount)}
								</span>
							</span>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}
