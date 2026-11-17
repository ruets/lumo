// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { useAccount, useAuthConfig, useMe } from "./lib/hooks";
import { AdminPage } from "./routes/Admin";
import { HabitsPage } from "./routes/Habits";
import { HouseholdPage } from "./routes/Household";
import { Login } from "./routes/Login";
import { NoHousehold } from "./routes/NoHousehold";
import { ProgressPage } from "./routes/Progress";
import { SettingsPage } from "./routes/Settings";
import { TodayPage } from "./routes/Today";
import { WishesPage } from "./routes/Wishes";

/** Entry point: loads the account, shows the sign-in, the no-household screen or the app shell. */
function Root() {
	const account = useAccount();
	const config = useAuthConfig();
	const inHousehold = Boolean(account.data?.household);
	const me = useMe(inHousehold);
	const loading = <p className="p-8 text-center text-muted">{t("common.loading")}</p>;
	if (account.isPending) return loading;
	if (account.isError || me.isError)
		return (
			<p role="alert" className="p-8 text-center text-bad">
				{t("common.error")}
			</p>
		);
	if (account.data === null) return config.data ? <Login config={config.data} /> : loading;
	if (!account.data.household) return <NoHousehold account={account.data} />;
	return me.data ? <AppShell me={me.data} /> : loading;
}

const rootRoute = createRootRoute({ component: Root });

/** Pages read the profile already loaded by the root. */
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
	page("/habits", HabitsPage),
	page("/progress", ProgressPage),
	page("/wishes", WishesPage),
	page("/settings", SettingsPage),
	page("/household", HouseholdPage),
	page("/admin", () => <AdminPage />),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
