// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MeResponse } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import { keys } from "../lib/hooks";
import { LanguageSelect } from "../lib/locale";
import { useToast } from "../lib/toast";
import { CoinIcon } from "./ui";

const icons: Record<string, ReactNode> = {
	today: (
		<>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
		</>
	),
	habits: (
		<>
			<path d="M17 2l4 4-4 4" />
			<path d="M3 11V9a3 3 0 0 1 3-3h15" />
			<path d="M7 22l-4-4 4-4" />
			<path d="M21 13v2a3 3 0 0 1-3 3H3" />
		</>
	),
	progress: <path d="M5 20v-8M12 20V5M19 20v-5" />,
	wishes: (
		<>
			<rect x="3" y="8" width="18" height="13" rx="2" />
			<path d="M12 8v13M3 12h18" />
			<path d="M12 8c-1.5-4-6-4.5-6-1.8C6 8 9 8 12 8zM12 8c1.5-4 6-4.5 6-1.8C18 8 15 8 12 8z" />
		</>
	),
};

const nav = [
	{ to: "/", key: "today", label: () => t("nav.today") },
	{ to: "/habits", key: "habits", label: () => t("nav.habits") },
	{ to: "/progress", key: "progress", label: () => t("nav.progress") },
	{ to: "/wishes", key: "wishes", label: () => t("nav.wishes") },
] as const;

function NavIcon({ name }: { name: string }) {
	return (
		<svg
			aria-hidden="true"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{icons[name]}
		</svg>
	);
}

export const BalanceChip = ({ balance }: { balance: number }) => (
	<Link
		to="/wishes"
		aria-label={t("progress.balance", { amount: balance })}
		className="flex min-h-11 items-center gap-1.5 rounded-full bg-raised px-3.5 font-display text-[15px] font-bold text-coin no-underline"
	>
		<CoinIcon />
		{balance}
	</Link>
);

export function AppShell({ me }: { me: MeResponse }) {
	const qc = useQueryClient();
	const toast = useToast();

	async function logout() {
		await api.logout().catch(() => undefined);
		qc.clear();
		qc.setQueryData(keys.me, null);
	}

	return (
		<div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
			<aside className="hidden flex-col gap-6 border-r border-line bg-nav p-5 md:sticky md:top-0 md:flex md:h-screen">
				<p className="m-0 font-display text-xl font-bold">{t("app.name")}</p>
				<nav aria-label={t("nav.main")} className="grid gap-1">
					{nav.map((n) => (
						<Link
							key={n.to}
							to={n.to}
							activeOptions={{ exact: true }}
							className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-muted no-underline hover:bg-raised data-[status=active]:bg-raised data-[status=active]:font-bold data-[status=active]:text-link"
							activeProps={{ "aria-current": "page" }}
						>
							<NavIcon name={n.key} />
							{n.label()}
						</Link>
					))}
				</nav>
				<div className="mt-auto grid gap-3">
					<BalanceChip balance={me.wallets.personal.balance} />
					<p className="m-0 text-xs text-muted">
						{me.user.displayName} · {me.household.name}
					</p>
					<LanguageSelect />
					<button
						type="button"
						onClick={() => void logout()}
						className="min-h-11 cursor-pointer rounded-xl border border-edge bg-transparent font-body text-sm font-semibold text-soft hover:bg-raised"
					>
						{t("auth.logout")}
					</button>
				</div>
			</aside>

			<main className="mx-auto w-full max-w-5xl px-5 pb-28 pt-12 md:px-10 md:pb-12">
				<Outlet />
				{/* The sidebar is hidden on small screens: language and sign-out live at the bottom of the page. */}
				<footer className="mt-10 grid gap-3 md:hidden">
					<LanguageSelect />
					<button
						type="button"
						onClick={() => void logout()}
						className="min-h-11 cursor-pointer rounded-xl border border-edge bg-transparent font-body text-sm font-semibold text-soft"
					>
						{t("auth.logout")}
					</button>
				</footer>
			</main>

			<nav
				aria-label={t("nav.main")}
				className="fixed inset-x-0 bottom-0 z-10 flex h-[88px] justify-around border-t border-line bg-nav px-3 pb-[22px] pt-2 md:hidden"
			>
				{nav.map((n) => (
					<Link
						key={n.to}
						to={n.to}
						activeOptions={{ exact: true }}
						className="flex min-h-[52px] min-w-[72px] flex-col items-center justify-center gap-1 text-xs font-semibold text-[#9a99b3] no-underline data-[status=active]:font-bold data-[status=active]:text-link"
						activeProps={{ "aria-current": "page" }}
					>
						<NavIcon name={n.key} />
						{n.label()}
					</Link>
				))}
			</nav>

			{toast && (
				<p
					role="status"
					className="fixed bottom-28 left-1/2 z-20 m-0 -translate-x-1/2 rounded-full bg-raised px-5 py-3 text-sm font-semibold text-ink shadow-lg md:bottom-8"
				>
					{toast}
				</p>
			)}
		</div>
	);
}
