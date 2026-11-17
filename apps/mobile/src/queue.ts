// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError } from "@lumo/api-client";
import { errorMessage } from "@lumo/i18n";
import type { QueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useSyncExternalStore } from "react";
import { api } from "./session";
import { createStore, readJson, showToast, writeJson } from "./store";

/**
 * File des validations hors ligne. Chaque entrée porte sa propre clé d'idempotence (`id`) :
 * un rejeu après une réponse perdue ne crédite jamais deux fois. Le serveur reste seul juge —
 * une validation refusée au rejeu (objectif atteint, jour trop ancien…) est abandonnée avec un message.
 */
export interface QueuedCompletion {
	/** Clé d'idempotence, fixée à la création. */
	id: string;
	itemId: string;
	/** Jour local de la validation, fixé à la création (un rejeu le lendemain garde le bon jour). */
	date: string;
	createdAt: string;
}

const KEY = "lumo.queue.v1";
const store = createStore<QueuedCompletion[]>([]);
let loaded: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
let queryClient: QueryClient | null = null;

const persist = () => writeJson(KEY, store.get());

export function bindQueryClient(qc: QueryClient): void {
	queryClient = qc;
}

export function loadQueue(): Promise<void> {
	loaded ??= readJson<QueuedCompletion[]>(KEY, []).then((q) => store.set(q));
	return loaded;
}

export const useQueue = () => useSyncExternalStore(store.subscribe, store.get);
export const queuedFor = (itemId: string, date: string) =>
	store.get().filter((o) => o.itemId === itemId && o.date === date);

export async function enqueueCompletion(itemId: string, date: string): Promise<void> {
	await loadQueue();
	store.set([...store.get(), { id: randomUUID(), itemId, date, createdAt: new Date().toISOString() }]);
	await persist();
	void flushQueue();
}

/** Annule localement la dernière validation en file de cet élément ce jour-là (rien n'a été envoyé). */
export async function dequeueLast(itemId: string, date: string): Promise<boolean> {
	await loadQueue();
	const mine = queuedFor(itemId, date);
	const last = mine[mine.length - 1];
	if (!last) return false;
	store.set(store.get().filter((o) => o.id !== last.id));
	await persist();
	return true;
}

/** Erreur de transport (pas de réponse du serveur) : on garde l'entrée et on réessaiera. */
const isRetryable = (err: unknown) => !(err instanceof ApiError) || err.status >= 500 || err.status === 401;

/** Envoie la file dans l'ordre ; s'arrête au premier échec réseau. Un seul envoi à la fois. */
export function flushQueue(): Promise<void> {
	flushing ??= (async () => {
		await loadQueue();
		let sentAny = false;
		while (store.get().length > 0) {
			const op = store.get()[0];
			if (!op) break;
			try {
				await api.complete(op.itemId, op.date, { idempotencyKey: op.id });
				sentAny = true;
			} catch (err) {
				if (isRetryable(err)) break;
				showToast(err instanceof ApiError ? errorMessage(err.code, err.message) : errorMessage("unknown"));
				sentAny = true;
			}
			store.set(store.get().filter((o) => o.id !== op.id));
			await persist();
		}
		if (sentAny) await queryClient?.invalidateQueries();
	})().finally(() => {
		flushing = null;
	});
	return flushing;
}
