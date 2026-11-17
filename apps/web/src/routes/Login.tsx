// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError, type AuthConfig } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Field, fieldClass, PrimaryButton } from "../components/ui";
import { api } from "../lib/api";
import { describeError, keys } from "../lib/hooks";
import { LanguageSelect } from "../lib/locale";

const params = new URLSearchParams(window.location.search);

export function Login({ config }: { config: AuthConfig }) {
	const qc = useQueryClient();
	const [error, setError] = useState<string | null>(params.get("auth_error"));
	const [busy, setBusy] = useState(false);
	// An invitation link (`/?invite=…`) opens the join form directly.
	const [joining, setJoining] = useState(params.has("invite"));
	const invite = params.get("invite") ?? "";
	const joinMode = joining && !config.setupRequired;

	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const v = (name: string) => String(form.get(name) ?? "").trim();
		setBusy(true);
		setError(null);
		try {
			if (config.setupRequired) {
				await api.setup({
					householdName: v("householdName"),
					displayName: v("displayName"),
					username: v("username"),
					password: String(form.get("password") ?? ""),
					client: "web",
				});
			} else if (joinMode) {
				await api.registerLocal({
					invite: v("invite"),
					displayName: v("displayName"),
					username: v("username"),
					password: String(form.get("password") ?? ""),
					client: "web",
				});
			} else {
				await api.loginLocal({ username: v("username"), password: String(form.get("password") ?? ""), client: "web" });
			}
			window.history.replaceState(null, "", "/");
			await qc.invalidateQueries({ queryKey: keys.account });
		} catch (err) {
			setError(err instanceof ApiError ? describeError(err) : t("auth.error"));
		} finally {
			setBusy(false);
		}
	}

	const oidcHref =
		joinMode && invite ? `/api/v1/auth/login?invite=${encodeURIComponent(invite)}` : "/api/v1/auth/login";
	const linkButton =
		"min-h-11 cursor-pointer border-0 bg-transparent font-body text-sm font-semibold text-link underline";

	return (
		<main className="grid min-h-screen place-items-center px-5">
			<section className="grid w-full max-w-sm gap-5 rounded-[26px] bg-surface p-7">
				<h1 className="m-0 font-display text-[32px] font-bold">{t("app.name")}</h1>
				{error && (
					<p role="alert" className="m-0 text-sm font-semibold text-bad">
						{t("auth.error")} ({error})
					</p>
				)}
				{config.oidc && !config.setupRequired && (
					<a
						href={oidcHref}
						className="grid min-h-12 place-items-center rounded-full bg-primary font-bold text-white no-underline"
					>
						{t("auth.oidc")}
					</a>
				)}
				{config.local && (
					<form onSubmit={submit} className="grid gap-3">
						<h2 className="m-0 text-base font-bold text-muted">
							{config.setupRequired ? t("auth.setup.title") : joinMode ? t("join.title") : t("auth.local")}
						</h2>
						{joinMode && <p className="m-0 text-sm text-muted">{t("join.hint")}</p>}
						{config.setupRequired && (
							<Field label={t("auth.setup.householdName")}>
								<input name="householdName" required className={fieldClass} />
							</Field>
						)}
						{joinMode && (
							<Field label={t("join.code")}>
								<input
									name="invite"
									defaultValue={invite}
									required
									minLength={10}
									autoComplete="off"
									className={fieldClass}
								/>
							</Field>
						)}
						{(config.setupRequired || joinMode) && (
							<Field label={t("auth.setup.displayName")}>
								<input name="displayName" required className={fieldClass} />
							</Field>
						)}
						<Field label={t("auth.username")}>
							<input name="username" autoComplete="username" required className={fieldClass} />
						</Field>
						<Field label={t("auth.password")}>
							<input
								name="password"
								type="password"
								autoComplete={config.setupRequired || joinMode ? "new-password" : "current-password"}
								minLength={config.setupRequired || joinMode ? 10 : undefined}
								required
								className={fieldClass}
							/>
						</Field>
						<PrimaryButton type="submit" disabled={busy}>
							{joinMode ? t("join.submit") : t("auth.submit")}
						</PrimaryButton>
						{!config.setupRequired && (
							<button type="button" onClick={() => setJoining(!joining)} className={linkButton}>
								{joinMode ? t("join.back") : t("join.have")}
							</button>
						)}
					</form>
				)}
				<LanguageSelect />
			</section>
		</main>
	);
}
