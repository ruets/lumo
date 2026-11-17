// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MeResponse, TodayItem } from "@lumo/api-client";
import { addDays, startOfWeek } from "@lumo/domain";
import { dayNumber, longDate, shortDate, t, weekdayShort } from "@lumo/i18n";
import { useState } from "react";
import { HeaderActions } from "../components/AppShell";
import { ItemDialog } from "../components/forms";
import { itemMeta } from "../components/itemMeta";
import { AddButton, PageTitle, Reward, Segmented } from "../components/ui";
import { useComplete, useStats, useToday, useUndo } from "../lib/hooks";

function Row({
	e,
	future,
	onComplete,
	onUndo,
}: {
	e: TodayItem;
	future: boolean;
	onComplete: () => void;
	onUndo: () => void;
}) {
	const multi = e.target > 1;
	const label = e.done
		? t("items.undo", { name: e.item.name })
		: multi
			? t("items.validateCount", { name: e.item.name, current: e.approved, target: e.target, count: e.item.reward })
			: t("items.validate", { name: e.item.name, count: e.item.reward });
	return (
		<div
			className={`flex min-h-[66px] items-center gap-3 rounded-[18px] py-2.5 pl-2.5 pr-4 ${e.done ? "bg-surface-done" : "bg-surface"}`}
		>
			<button
				type="button"
				aria-label={label}
				disabled={future || (!e.done && e.pending > 0 && e.approved + e.pending >= e.target)}
				onClick={e.done ? onUndo : onComplete}
				className={`flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full font-body text-xs font-bold disabled:cursor-default disabled:opacity-50 ${
					e.done ? "border-0 bg-ok text-bg" : "border-2 border-primary-soft bg-transparent text-soft"
				}`}
			>
				{e.done ? (
					<svg
						aria-hidden="true"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M5 12.5l4.5 4.5L19 7.5" />
					</svg>
				) : multi ? (
					`${e.approved}/${e.target}`
				) : null}
			</button>
			<span className="flex grow flex-col gap-[3px]">
				<span className={`text-[15px] font-bold ${e.done ? "text-[#8f8ea8] line-through" : "text-ink"}`}>
					{e.item.name}
				</span>
				<span className="text-[13px] text-muted">{itemMeta(e)}</span>
			</span>
			<Reward amount={e.item.reward} />
		</div>
	);
}

export function HabitsPage({ me }: { me: MeResponse }) {
	const now = useToday();
	const [picked, setPicked] = useState<string | null>(null);
	const [tab, setTab] = useState<"habit" | "task">("habit");
	const [creating, setCreating] = useState(false);

	const today = now.data?.date;
	const day = picked ?? today;
	const weekFrom = today ? startOfWeek(today, 1) : undefined;
	const stats = useStats(weekFrom, weekFrom ? addDays(weekFrom, 6) : undefined);
	const view = useToday(picked && picked !== today ? picked : undefined);
	const complete = useComplete(picked && picked !== today ? picked : undefined);
	const undo = useUndo();

	if (!today || !day || !weekFrom) return <p className="text-muted">{t("common.loading")}</p>;

	const days = Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i));
	const heat = new Map(stats.data?.heatmap.map((h) => [h.date, h]));
	const entries = (picked && picked !== today ? view.data : now.data)?.items ?? [];
	const list = entries.filter((e) => e.item.kind === tab);
	const doneCount = entries.filter((e) => e.done).length;

	return (
		<div className="grid gap-5">
			<header className="flex items-end justify-between">
				<div className="grid gap-1.5">
					<p className="m-0 text-sm font-semibold text-muted">
						{shortDate(day)} · {t("today.doneOf", { done: doneCount, total: entries.length })}
					</p>
					<PageTitle>{t("nav.habits")}</PageTitle>
				</div>
				<HeaderActions balance={me.wallets.personal.balance} name={me.user.displayName} />
			</header>

			<Segmented
				label={t("items.type")}
				value={tab}
				onChange={setTab}
				options={[
					{ id: "habit", label: t("items.habits") },
					{ id: "task", label: t("items.tasks") },
				]}
			/>

			<fieldset className="m-0 grid min-w-0 grid-cols-7 gap-1.5 border-0 p-0">
				<legend className="sr-only">{t("items.weekDays")}</legend>
				{days.map((d, i) => {
					const h = heat.get(d);
					const on = d === day;
					const dot =
						!h || h.expected === 0
							? "transparent"
							: h.done >= h.expected
								? "#3ddc97"
								: h.done > 0
									? "#ffc857"
									: "transparent";
					return (
						<button
							key={d}
							type="button"
							aria-pressed={on}
							aria-label={t("items.dayLabel", { date: longDate(d), done: h?.done ?? 0, total: h?.expected ?? 0 })}
							onClick={() => setPicked(d === today ? null : d)}
							className={`flex h-[70px] cursor-pointer flex-col items-center justify-center gap-[3px] rounded-2xl border-0 font-body ${on ? "bg-primary text-white" : "bg-surface text-soft hover:bg-raised"}`}
						>
							<span className="text-xs font-semibold">{weekdayShort(i + 1)}</span>
							<span className="font-display text-base font-bold">{dayNumber(d)}</span>
							<span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: dot }} />
						</button>
					);
				})}
			</fieldset>

			<div className="grid gap-2.5 md:grid-cols-2">
				{list.length === 0 && <p className="m-0 text-muted md:col-span-2">{t("items.empty")}</p>}
				{list.map((e) => (
					<Row
						key={e.item.id}
						e={e}
						future={day > today}
						onComplete={() => complete.mutate(e.item.id)}
						onUndo={() => e.completionIds[0] && undo.mutate(e.completionIds[0])}
					/>
				))}
			</div>

			<AddButton label={tab === "habit" ? t("items.newHabit") : t("items.newTask")} onClick={() => setCreating(true)} />
			{creating && <ItemDialog kind={tab} onClose={() => setCreating(false)} />}
		</div>
	);
}
