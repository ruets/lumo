// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { flushQueue } from "./queue";

/** Pull to refresh: sends the offline queue then reloads every query. */
export function useRefresh() {
	const qc = useQueryClient();
	const [busy, setBusy] = useState(false);
	return {
		busy,
		run: () => {
			setBusy(true);
			void flushQueue()
				.then(() => qc.invalidateQueries())
				.finally(() => setBusy(false));
		},
	};
}
