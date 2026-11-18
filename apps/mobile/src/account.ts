// SPDX-License-Identifier: AGPL-3.0-or-later

import { setActiveHouseholdId } from "./household";
import { persister, queryClient } from "./query";
import { clearQueue } from "./queue";
import { forgetServer } from "./server";
import { api, clearTokens } from "./session";

/** Sign out: revokes the session on the server (if reachable), clears tokens and local data. */
export async function logout(): Promise<void> {
	await api.logout().catch(() => undefined);
	await wipeLocalData();
}

/**
 * Change server: everything that comes from the old one (tokens, cache, pending completions) is erased,
 * so two households are never mixed and a completion is never sent to the wrong server.
 */
export async function changeServer(): Promise<void> {
	await api.logout().catch(() => undefined);
	await wipeLocalData();
	await forgetServer();
}

async function wipeLocalData(): Promise<void> {
	await clearTokens();
	await setActiveHouseholdId(null);
	await clearQueue();
	queryClient.clear();
	await persister.removeClient();
}
