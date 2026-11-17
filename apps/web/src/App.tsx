// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError, type AuthConfig, createClient, type MeResponse } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { type FormEvent, useCallback, useEffect, useState } from "react";

const api = createClient({ baseUrl: "" });

type State =
	| { status: "loading" }
	| { status: "anonymous"; config: AuthConfig }
	| { status: "authenticated"; me: MeResponse };

const card = {
	maxWidth: 420,
	margin: `${spacing.xl}px auto`,
	padding: spacing.lg,
	background: colors.surface,
	borderRadius: radii.md,
	display: "grid",
	gap: spacing.md,
} as const;

const input = { padding: spacing.sm, borderRadius: radii.sm, border: "1px solid #d1d5db", font: "inherit" } as const;
const button = {
	padding: spacing.sm,
	borderRadius: radii.sm,
	border: 0,
	background: colors.primary,
	color: colors.primaryText,
	font: "inherit",
	fontWeight: 600,
	cursor: "pointer",
	textAlign: "center",
	textDecoration: "none",
} as const;

export function App() {
	const [state, setState] = useState<State>({ status: "loading" });

	const refresh = useCallback(async () => {
		try {
			setState({ status: "authenticated", me: await api.getMe() });
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				setState({ status: "anonymous", config: await api.getAuthConfig() });
			} else {
				throw err;
			}
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return (
		<main
			style={{
				fontFamily: "system-ui, sans-serif",
				background: colors.background,
				color: colors.text,
				minHeight: "100vh",
				padding: spacing.md,
			}}
		>
			{state.status === "loading" && <p style={{ textAlign: "center" }}>{t("common.loading")}</p>}
			{state.status === "anonymous" && <Login config={state.config} onDone={refresh} />}
			{state.status === "authenticated" && <Home me={state.me} onLogout={refresh} />}
		</main>
	);
}

function Login({ config, onDone }: { config: AuthConfig; onDone: () => Promise<void> }) {
	const [error, setError] = useState<string | null>(new URLSearchParams(window.location.search).get("auth_error"));
	const [busy, setBusy] = useState(false);

	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const value = (name: string) => String(form.get(name) ?? "");
		setBusy(true);
		setError(null);
		try {
			if (config.setupRequired) {
				await api.setup({
					householdName: value("householdName"),
					displayName: value("displayName"),
					username: value("username"),
					password: value("password"),
					client: "web",
				});
			} else {
				await api.loginLocal({ username: value("username"), password: value("password"), client: "web" });
			}
			window.history.replaceState(null, "", "/");
			await onDone();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : t("auth.error"));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section style={card}>
			<h1 style={{ margin: 0 }}>{t("app.name")}</h1>
			{error && (
				<p role="alert" style={{ color: colors.danger, margin: 0 }}>
					{t("auth.error")} ({error})
				</p>
			)}
			{config.oidc && !config.setupRequired && (
				<a href="/api/v1/auth/login" style={button}>
					{t("auth.oidc")}
				</a>
			)}
			{config.local && (
				<form onSubmit={submit} style={{ display: "grid", gap: spacing.sm }}>
					<h2 style={{ margin: 0, fontSize: 18 }}>{config.setupRequired ? "Créer le foyer" : t("auth.local")}</h2>
					{config.setupRequired && (
						<>
							<input style={input} name="householdName" placeholder="Nom du foyer" required />
							<input style={input} name="displayName" placeholder="Votre prénom" required />
						</>
					)}
					<input style={input} name="username" placeholder={t("auth.username")} autoComplete="username" required />
					<input
						style={input}
						name="password"
						type="password"
						placeholder={t("auth.password")}
						autoComplete={config.setupRequired ? "new-password" : "current-password"}
						minLength={10}
						required
					/>
					<button style={button} type="submit" disabled={busy}>
						{t("auth.submit")}
					</button>
				</form>
			)}
		</section>
	);
}

function Home({ me, onLogout }: { me: MeResponse; onLogout: () => Promise<void> }) {
	async function logout() {
		await api.logout();
		await onLogout();
	}
	return (
		<section style={card}>
			<h1 style={{ margin: 0 }}>{t("home.greeting", { name: me.user.displayName })}</h1>
			<p style={{ margin: 0 }}>{t("home.household", { name: me.household.name })}</p>
			<p style={{ margin: 0 }}>{t("home.wallet.personal", { amount: me.wallets.personal.balance })}</p>
			<p style={{ margin: 0 }}>{t("home.wallet.shared", { amount: me.wallets.shared.balance })}</p>
			<button type="button" style={button} onClick={() => void logout()}>
				{t("auth.logout")}
			</button>
		</section>
	);
}
