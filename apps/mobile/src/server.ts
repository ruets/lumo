// SPDX-License-Identifier: AGPL-3.0-or-later
import { type AuthConfig, createClient } from "@lumo/api-client";
import { useSyncExternalStore } from "react";
import { createStore, readJson, writeJson } from "./store";

/** Le serveur choisi par l'utilisateur : l'appli est la même pour tous les foyers. */
const KEY = "lumo.server.v1";
const store = createStore<{ loaded: boolean; url: string | null }>({ loaded: false, url: null });
let loading: Promise<void> | null = null;

export function loadServer(): Promise<void> {
	loading ??= readJson<string | null>(KEY, null).then((url) => store.set({ loaded: true, url }));
	return loading;
}

export const useServer = () => useSyncExternalStore(store.subscribe, store.get);
/** URL courante, sans slash final ; vide tant qu'aucun serveur n'est choisi. */
export const currentServerUrl = (): string => store.get().url ?? "";

export async function saveServer(url: string): Promise<void> {
	store.set({ loaded: true, url });
	await writeJson(KEY, url);
}

export async function forgetServer(): Promise<void> {
	store.set({ loaded: true, url: null });
	await writeJson(KEY, null);
}

export class ServerError extends Error {
	constructor(readonly code: "unreachable" | "not_lumo") {
		super(code);
	}
}

const TIMEOUT_MS = 8000;

/** Vérifie qu'une adresse est bien un serveur Lumo (`GET /auth/config`) et renvoie sa config. */
export async function verifyServer(url: string, timeoutMs = TIMEOUT_MS): Promise<AuthConfig> {
	const client = createClient({ baseUrl: url });
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new ServerError("unreachable")), timeoutMs);
	});
	try {
		const config = await Promise.race([client.getAuthConfig(), timeout]);
		if (config?.app !== "lumo") throw new ServerError("not_lumo");
		return config;
	} catch (err) {
		if (err instanceof ServerError) throw err;
		// Pas de réponse : injoignable. Une réponse qui n'est pas du JSON Lumo : autre chose qu'un serveur Lumo.
		throw new ServerError(err instanceof TypeError ? "unreachable" : "not_lumo");
	} finally {
		clearTimeout(timer);
	}
}
