// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MeResponse } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageTitle } from "../components/ui";
import { useLogout } from "../lib/hooks";
import { LanguageSelect } from "../lib/locale";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="grid gap-2.5">
			<h2 className="m-0 text-[15px] font-bold text-muted">{title}</h2>
			<div className="grid gap-3.5 rounded-[20px] bg-surface p-4">{children}</div>
		</section>
	);
}

export function SettingsPage({ me }: { me: MeResponse }) {
	const logout = useLogout();
	return (
		<div className="grid max-w-xl gap-5">
			<PageTitle>{t("settings.title")}</PageTitle>
			<Section title={t("settings.account")}>
				<p className="m-0 text-lg font-bold">{me.user.displayName}</p>
				<p className="m-0 text-sm text-muted">
					{t(`role.${me.role}` as const)} · {t("settings.household", { name: me.household.name })}
				</p>
				<button
					type="button"
					onClick={() => void logout()}
					className="min-h-11 cursor-pointer rounded-xl border border-edge bg-transparent font-body text-sm font-semibold text-soft hover:bg-raised"
				>
					{t("auth.logout")}
				</button>
			</Section>
			<Link
				to="/household"
				className="flex min-h-12 items-center justify-between rounded-[20px] bg-surface px-4 font-semibold text-ink no-underline hover:bg-raised"
			>
				{t("household.open")}
				<span aria-hidden="true">›</span>
			</Link>
			<Section title={t("language.title")}>
				<LanguageSelect />
			</Section>
		</div>
	);
}
