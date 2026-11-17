// SPDX-License-Identifier: AGPL-3.0-or-later

import { persister, queryClient } from "./query";
import { clearQueue } from "./queue";
import { forgetServer } from "./server";
import { api, clearTokens } from "./session";

/** Se déconnecter : révoque la session côté serveur (si joignable), efface jetons et données locales. */
export async function logout(): Promise<void> {
	await api.logout().catch(() => undefined);
	await wipeLocalData();
}

/**
 * Changer de serveur : tout ce qui vient de l'ancien (jetons, cache, validations en attente) est effacé,
 * pour ne jamais mélanger deux foyers ni envoyer une validation au mauvais serveur.
 */
export async function changeServer(): Promise<void> {
	await api.logout().catch(() => undefined);
	await wipeLocalData();
	await forgetServer();
}

async function wipeLocalData(): Promise<void> {
	await clearTokens();
	await clearQueue();
	queryClient.clear();
	await persister.removeClient();
}
