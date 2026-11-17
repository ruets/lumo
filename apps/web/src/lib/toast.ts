// SPDX-License-Identifier: AGPL-3.0-or-later
import { useSyncExternalStore } from "react";

let message: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export function showToast(text: string, ms = 4000): void {
	message = text;
	for (const l of listeners) l();
	clearTimeout(timer);
	timer = setTimeout(() => {
		message = null;
		for (const l of listeners) l();
	}, ms);
}

export function useToast(): string | null {
	return useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => message,
	);
}
