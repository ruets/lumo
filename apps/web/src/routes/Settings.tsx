// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MeResponse } from "@lumo/api-client";
import { errorMessage, t } from "@lumo/i18n";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { fieldClass, PageTitle } from "../components/ui";
import { useAccount, useAuthConfig, useLeaveHousehold, useLogout, useSwitchHousehold } from "../lib/hooks";
import { LanguageSelect } from "../lib/locale";
import { showToast } from "../lib/toast";
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
	const authConfig = useAuthConfig().data;
	const provider = authConfig?.oidcName ?? "SSO";

	// Back from Authentik after "Link my Authentik account": say how it went, then clean the address.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (!params.has("linked") && !params.has("auth_error")) return;
		const code = params.get("auth_error");
		showToast(code ? errorMessage(code) : t("link.done", { provider }), 4000);
		window.history.replaceState(null, "", window.location.pathname);
	}, [provider]);
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
			{authConfig?.oidc && account && (
				<Section title={t("link.title", { provider })}>
					{account.oidc ? (
						<p className="m-0 text-sm font-semibold text-ok">{t("link.linked", { provider })}</p>
					) : (
						<>
							<p className="m-0 text-sm text-muted">{t("link.hint", { provider })}</p>
							<a
								href="/api/v1/auth/link"
								className="grid min-h-11 place-items-center rounded-full bg-primary font-bold text-white no-underline"
							>
								{t("link.button", { provider })}
							</a>
						</>
					)}
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
			<Link
				to="/supervision"
				className="flex min-h-12 items-center justify-between rounded-[20px] bg-surface px-4 font-semibold text-ink no-underline hover:bg-raised"
			>
				{t("supervision.open")}
				<span aria-hidden="true">›</span>
			</Link>
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
