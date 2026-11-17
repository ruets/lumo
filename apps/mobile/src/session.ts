// SPDX-License-Identifier: AGPL-3.0-or-later
import { createClient, type TokenPair } from "@lumo/api-client";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { currentServerUrl } from "./server";

const KEY = "lumo.tokens";

interface Stored {
	accessToken: string;
	refreshToken: string;
	/** Unix ms expiry of the access token. */
	expiresAt: number;
}

let cache: Stored | null | undefined;
let refreshing: Promise<Stored | null> | null = null;

async function load(): Promise<Stored | null> {
	if (cache !== undefined) return cache;
	const raw = await SecureStore.getItemAsync(KEY);
	cache = raw ? (JSON.parse(raw) as Stored) : null;
	return cache;
}

export async function saveTokens(tokens: TokenPair): Promise<void> {
	cache = {
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: Date.now() + tokens.expiresIn * 1000,
	};
	await SecureStore.setItemAsync(KEY, JSON.stringify(cache));
}

export async function clearTokens(): Promise<void> {
	cache = null;
	await SecureStore.deleteItemAsync(KEY);
}

const bare = createClient({ baseUrl: currentServerUrl, generateKey: randomUUID });

/** Valid access token; the refresh token is rotated (one refresh request at a time). */
async function getAccessToken(): Promise<string | null> {
	const stored = await load();
	if (!stored) return null;
	if (stored.expiresAt - Date.now() > 30_000) return stored.accessToken;
	refreshing ??= bare
		.refresh(stored.refreshToken)
		.then(async (tokens) => {
			await saveTokens(tokens);
			return cache ?? null;
		})
		.catch(async () => {
			await clearTokens();
			return null;
		})
		.finally(() => {
			refreshing = null;
		});
	return (await refreshing)?.accessToken ?? null;
}

export const api = createClient({ baseUrl: currentServerUrl, getAccessToken, generateKey: randomUUID });
