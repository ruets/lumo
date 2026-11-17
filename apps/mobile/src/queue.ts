// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError } from "@lumo/api-client";
import { errorMessage } from "@lumo/i18n";
import type { QueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useSyncExternalStore } from "react";
import { api } from "./session";
import { createStore, readJson, showToast, writeJson } from "./store";

/**
 * Offline completion queue. Each entry carries its own idempotency key (`id`):
 * a replay after a lost response never credits twice. The server stays the only judge —
 * a completion refused on replay (goal reached, day too old…) is dropped with a message.
 */
export interface QueuedCompletion {
	/** Idempotency key, fixed at creation. */
	id: string;
	itemId: string;
	/** Local day of the completion, fixed at creation (a replay the next day keeps the right day). */
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

/** Empties the queue (server or account change: these completions are no longer ours). */
export async function clearQueue(): Promise<void> {
	await loadQueue();
	store.set([]);
	await persist();
}

/** Locally cancels the last queued completion of this item that day (nothing was sent). */
export async function dequeueLast(itemId: string, date: string): Promise<boolean> {
	await loadQueue();
	const mine = queuedFor(itemId, date);
	const last = mine[mine.length - 1];
	if (!last) return false;
	store.set(store.get().filter((o) => o.id !== last.id));
	await persist();
	return true;
}

/** Transport error (no response from the server): we keep the entry and retry. */
const isRetryable = (err: unknown) => !(err instanceof ApiError) || err.status >= 500 || err.status === 401;

/** Sends the queue in order; stops at the first network failure. One send at a time. */
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
