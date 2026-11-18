// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

/** The root screen watches the "account" query: signing out must reach it, or the UI stays on the signed-in screen. */
async function watching() {
	const qc = new QueryClient();
	qc.setQueryData(["account"], { id: "u1" });
	qc.setQueryData(["items"], [1]);
	const observer = new QueryObserver<unknown>(qc, {
		queryKey: ["account"],
		queryFn: async () => ({ id: "u1" }),
		staleTime: 60_000,
	});
	const seen: unknown[] = [];
	observer.subscribe((r) => seen.push(r.data));
	return { qc, seen };
}

describe("signing out", () => {
	it("clear() leaves the watching screen on stale data (the bug)", async () => {
		const { qc, seen } = await watching();
		qc.clear();
		qc.setQueryData(["account"], null);
		expect(seen).not.toContain(null);
	});

	it("marking the account as signed out first, then dropping the rest, reaches the screen", async () => {
		const { qc, seen } = await watching();
		qc.setQueryData(["account"], null);
		qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "account" });
		expect(seen).toContain(null);
		expect(qc.getQueryData(["items"])).toBeUndefined();
	});
});
