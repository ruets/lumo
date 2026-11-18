// SPDX-License-Identifier: AGPL-3.0-or-later
import { effectiveFilter, type SpaceFilter } from "@lumo/api-client";
import { useSyncExternalStore } from "react";
import { createStore } from "./store";

/** Which space the lists show: everything (default), the personal space, or one household. */
const store = createStore<SpaceFilter>("all");

export const setSpaceFilter = (next: SpaceFilter): void => store.set(next);

/** The filter in force, never naming a household the person is not in. */
export function useSpaceFilter(households: readonly { id: string }[]): SpaceFilter {
	return effectiveFilter(useSyncExternalStore(store.subscribe, store.get), households);
}
