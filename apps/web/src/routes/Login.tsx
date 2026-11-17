// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError, type AuthConfig } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Field, fieldClass, PrimaryButton } from "../components/ui";
import { api } from "../lib/api";
import { describeError, keys } from "../lib/hooks";

export function Login({ config }: { config: AuthConfig }) {
	const qc = useQueryClient();
	const [error, setError] = useState<string | null>(new URLSearchParams(window.location.search).get("auth_error"));
	const [busy, setBusy] = useState(false);

	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const v = (name: string) => String(form.get(name) ?? "");
		setBusy(true);
		setError(null);
		try {
			if (config.setupRequired) {
				await api.setup({
					householdName: v("householdName"),
					displayName: v("displayName"),
					username: v("username"),
					password: v("password"),
					client: "web",
				});
			} else {
				await api.loginLocal({ username: v("username"), password: v("password"), client: "web" });
			}
			window.history.replaceState(null, "", "/");
			await qc.invalidateQueries({ queryKey: keys.me });
		} catch (err) {
			setError(err instanceof ApiError ? describeError(err) : t("auth.error"));
		} finally {
			setBusy(false);
		}
	}

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
						href="/api/v1/auth/login"
						className="grid min-h-12 place-items-center rounded-full bg-primary font-bold text-white no-underline"
					>
						{t("auth.oidc")}
					</a>
				)}
				{config.local && (
					<form onSubmit={submit} className="grid gap-3">
						<h2 className="m-0 text-base font-bold text-muted">
							{config.setupRequired ? "Créer le foyer" : t("auth.local")}
						</h2>
						{config.setupRequired && (
							<>
								<Field label="Nom du foyer">
									<input name="householdName" required className={fieldClass} />
								</Field>
								<Field label="Ton prénom">
									<input name="displayName" required className={fieldClass} />
								</Field>
							</>
						)}
						<Field label={t("auth.username")}>
							<input name="username" autoComplete="username" required className={fieldClass} />
						</Field>
						<Field label={t("auth.password")}>
							<input
								name="password"
								type="password"
								autoComplete={config.setupRequired ? "new-password" : "current-password"}
								minLength={10}
								required
								className={fieldClass}
							/>
						</Field>
						<PrimaryButton type="submit" disabled={busy}>
							{t("auth.submit")}
						</PrimaryButton>
					</form>
				)}
			</section>
		</main>
	);
}
