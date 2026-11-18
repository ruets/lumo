// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MeResponse } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { fieldClass, PageTitle } from "../components/ui";
import { useAccount, useLeaveHousehold, useLogout, useSwitchHousehold } from "../lib/hooks";
import { LanguageSelect } from "../lib/locale";
import { AccountSettings } from "./AccountSettings";
import { HouseholdAccess } from "./NoHousehold";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="grid gap-2.5">
			<h2 className="m-0 text-[15px] font-bold text-muted">{title}</h2>
			<div className="grid gap-3.5 rounded-[20px] bg-surface p-4">{children}</div>
		</section>
	);
}

export function SettingsPage({ me }: { me: MeResponse }) {
	const household = me.household;
	const logout = useLogout();
	const leave = useLeaveHousehold();
	const account = useAccount().data;
	const isSuperAdmin = account?.isSuperAdmin ?? false;
	const switchHousehold = useSwitchHousehold();
	return (
		<div className="grid max-w-xl gap-5">
			<PageTitle>{t("settings.title")}</PageTitle>
			<Section title={t("settings.account")}>
				<p className="m-0 text-lg font-bold">{me.user.displayName}</p>
				<p className="m-0 text-sm text-muted">
					{me.household && me.role
						? `${t(`role.${me.role}` as const)} · ${t("settings.household", { name: me.household.name })}`
						: t("settings.noHousehold")}
				</p>
				<button
					type="button"
					onClick={() => void logout()}
					className="min-h-11 cursor-pointer rounded-xl border border-edge bg-transparent font-body text-sm font-semibold text-soft hover:bg-raised"
				>
					{t("auth.logout")}
				</button>
				{household && (
					<button
						type="button"
						disabled={leave.isPending}
						onClick={() => window.confirm(t("household.leaveConfirm", { name: household.name })) && leave.mutate()}
						className="min-h-11 cursor-pointer rounded-xl border border-edge bg-transparent font-body text-sm font-semibold text-bad hover:bg-raised"
					>
						{t("household.leave")}
					</button>
				)}
			</Section>
			{account && (
				<Section title={t("account.title")}>
					<AccountSettings account={account} />
				</Section>
			)}
			{me.households.length > 1 && (
				<Section title={t("household.switch")}>
					<select
						aria-label={t("household.switch")}
						value={me.household?.id ?? ""}
						onChange={(e) => switchHousehold(e.target.value)}
						className={fieldClass}
					>
						{me.households.map((h) => (
							<option key={h.id} value={h.id}>
								{h.name}
							</option>
						))}
					</select>
				</Section>
			)}
			{me.household && (
				<Link
					to="/household"
					className="flex min-h-12 items-center justify-between rounded-[20px] bg-surface px-4 font-semibold text-ink no-underline hover:bg-raised"
				>
					{t("household.open")}
					<span aria-hidden="true">›</span>
				</Link>
			)}
			{account && (
				<Section title={me.household ? t("household.add") : t("settings.accessTitle")}>
					<HouseholdAccess account={account} hint={!me.household} />
				</Section>
			)}
			{isSuperAdmin && (
				<Link
					to="/admin"
					className="flex min-h-12 items-center justify-between rounded-[20px] bg-surface px-4 font-semibold text-ink no-underline hover:bg-raised"
				>
					{t("admin.open")}
					<span aria-hidden="true">›</span>
				</Link>
			)}
			<Section title={t("language.title")}>
				<LanguageSelect />
			</Section>
		</div>
	);
}
