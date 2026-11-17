// SPDX-License-Identifier: AGPL-3.0-or-later
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/** Petit store observable : `subscribe` + instantané immuable, compatible `useSyncExternalStore`. */
export function createStore<T>(initial: T) {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set(next: T) {
			value = next;
			for (const l of listeners) l();
		},
		subscribe(cb: () => void) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
	};
}

const toastStore = createStore<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, ms = 4000): void {
	toastStore.set(text);
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toastStore.set(null), ms);
}

export const useToast = () => useSyncExternalStore(toastStore.subscribe, toastStore.get);

export async function readJson<T>(key: string, fallback: T): Promise<T> {
	try {
		const raw = await AsyncStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

export const writeJson = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value));
