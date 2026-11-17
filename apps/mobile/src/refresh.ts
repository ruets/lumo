// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { flushQueue } from "./queue";

/** Tirer pour rafraîchir : envoie la file hors ligne puis recharge toutes les requêtes. */
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
