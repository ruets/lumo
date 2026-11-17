// SPDX-License-Identifier: AGPL-3.0-or-later
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { bindQueryClient } from "./queue";

export const queryClient = new QueryClient({
	defaultOptions: { queries: { staleTime: 10_000, retry: 1, gcTime: 24 * 3_600_000 } },
});
bindQueryClient(queryClient);
export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "lumo.query-cache.v1" });
