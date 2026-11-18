// SPDX-License-Identifier: AGPL-3.0-or-later
import { effectiveFilter, type SpaceFilter } from "@lumo/api-client";
import { useSyncExternalStore } from "react";

/** Which space the lists show: everything (default), the personal space, or one household. Remembered locally. */
const KEY = "lumo.space";
const listeners = new Set<() => void>();

function read(): SpaceFilter {
	try {
		return window.localStorage.getItem(KEY) || "all";
	} catch {
		return "all";
	}
}

let current: SpaceFilter = read();

export function setSpaceFilter(next: SpaceFilter): void {
	current = next;
	try {
		window.localStorage.setItem(KEY, next);
	} catch {
		// storage unavailable: the choice only lasts until the page is reloaded
	}
	for (const l of listeners) l();
}

/** The filter in force, never naming a household the person is not in. */
export function useSpaceFilter(households: readonly { id: string }[]): SpaceFilter {
	const raw = useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => current,
	);
	return effectiveFilter(raw, households);
}
