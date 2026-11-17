// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { useAuthConfig, useMe } from "./lib/hooks";
import { HabitsPage } from "./routes/Habits";
import { Login } from "./routes/Login";
import { ProgressPage } from "./routes/Progress";
import { TodayPage } from "./routes/Today";
import { WishesPage } from "./routes/Wishes";

/** Porte d'entrée : charge le profil, affiche la connexion ou la coque de l'appli. */
function Root() {
	const me = useMe();
	const config = useAuthConfig();
	if (me.isPending) return <p className="p-8 text-center text-muted">{t("common.loading")}</p>;
	if (me.isError)
		return (
			<p role="alert" className="p-8 text-center text-bad">
				{t("common.error")}
			</p>
		);
	if (me.data === null) {
		return config.data ? (
			<Login config={config.data} />
		) : (
			<p className="p-8 text-center text-muted">{t("common.loading")}</p>
		);
	}
	return <AppShell me={me.data} />;
}

const rootRoute = createRootRoute({ component: Root });

/** Les pages lisent le profil déjà chargé par la racine. */
function page<P extends string>(
	path: P,
	Component: (p: { me: NonNullable<ReturnType<typeof useMe>["data"]> }) => React.ReactNode,
) {
	return createRoute({
		getParentRoute: () => rootRoute,
		path,
		component: function Page() {
			const me = useMe().data;
			return me ? <Component me={me} /> : null;
		},
	});
}

const routeTree = rootRoute.addChildren([
	page("/", TodayPage),
	page("/habitudes", HabitsPage),
	page("/progres", ProgressPage),
	page("/envies", WishesPage),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
