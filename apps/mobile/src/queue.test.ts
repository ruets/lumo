// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
	default: {
		getItem: async (k: string) => storage.get(k) ?? null,
		setItem: async (k: string, v: string) => void storage.set(k, v),
	},
}));
let seq = 0;
vi.mock("expo-crypto", () => ({ randomUUID: () => `key-${++seq}` }));
const complete = vi.fn();
vi.mock("./session", () => ({ api: { complete: (...a: unknown[]) => complete(...a) } }));

/** Module neuf à chaque test (état de la file remis à zéro) ; `ApiError` doit venir du même graphe de modules. */
async function fresh() {
	vi.resetModules();
	const [queue, client] = await Promise.all([import("./queue.js"), import("@lumo/api-client")]);
	return { ...queue, ApiError: client.ApiError };
}

beforeEach(() => {
	storage.clear();
	seq = 0;
	complete.mockReset();
});

describe("file hors ligne", () => {
	it("envoie dans l'ordre, avec une clé d'idempotence fixée à la création, puis se vide", async () => {
		complete.mockResolvedValue({});
		const q = await fresh();
		await q.enqueueCompletion("a", "2026-11-17");
		await q.enqueueCompletion("b", "2026-11-17");
		await q.flushQueue();
		expect(complete.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
			["a", "2026-11-17", { idempotencyKey: "key-1" }],
			["b", "2026-11-17", { idempotencyKey: "key-2" }],
		]);
		expect(JSON.parse(storage.get("lumo.queue.v1") ?? "[]")).toEqual([]);
	});

	it("réseau coupé : garde tout, et rejoue avec les MÊMES clés au retour (pas de double crédit)", async () => {
		complete.mockRejectedValue(new TypeError("Network request failed"));
		const q = await fresh();
		await q.enqueueCompletion("a", "2026-11-17");
		await q.enqueueCompletion("a", "2026-11-17");
		await q.flushQueue();
		expect(JSON.parse(storage.get("lumo.queue.v1") ?? "[]")).toHaveLength(2);

		// Redémarrage de l'appli : la file est relue depuis le stockage.
		complete.mockReset();
		complete.mockResolvedValue({});
		const q2 = await fresh();
		await q2.loadQueue();
		await q2.flushQueue();
		expect(complete.mock.calls.map((c) => c[2])).toEqual([{ idempotencyKey: "key-1" }, { idempotencyKey: "key-2" }]);
	});

	it("s'arrête au premier échec réseau pour garder l'ordre", async () => {
		complete.mockResolvedValueOnce({}).mockRejectedValue(new TypeError("offline"));
		const q = await fresh();
		await q.enqueueCompletion("a", "2026-11-17");
		await q.enqueueCompletion("b", "2026-11-17");
		await q.enqueueCompletion("c", "2026-11-17");
		await q.flushQueue();
		expect(complete.mock.calls[0]?.[0]).toBe("a");
		expect(q.queuedFor("a", "2026-11-17")).toHaveLength(0);
		expect(q.queuedFor("b", "2026-11-17")).toHaveLength(1);
		expect(q.queuedFor("c", "2026-11-17")).toHaveLength(1);
	});

	it("un refus du serveur (409) abandonne l'entrée sans bloquer les suivantes", async () => {
		const q = await fresh();
		complete.mockRejectedValueOnce(new q.ApiError(409, "target_reached", "Objectif atteint")).mockResolvedValueOnce({});
		await q.enqueueCompletion("a", "2026-11-17");
		await q.enqueueCompletion("b", "2026-11-17");
		await q.flushQueue();
		expect(complete).toHaveBeenCalledTimes(2);
		expect(JSON.parse(storage.get("lumo.queue.v1") ?? "[]")).toEqual([]);
	});

	it("une erreur 5xx ou 401 est réessayée plus tard", async () => {
		const q = await fresh();
		complete.mockRejectedValue(new q.ApiError(503, "unavailable", "x"));
		await q.enqueueCompletion("a", "2026-11-17");
		await q.flushQueue();
		expect(q.queuedFor("a", "2026-11-17")).toHaveLength(1);
	});

	it("la date de validation est celle du jour de la saisie, même rejouée le lendemain", async () => {
		complete.mockResolvedValue({});
		const q = await fresh();
		await q.enqueueCompletion("a", "2026-11-17");
		vi.setSystemTime(new Date("2026-11-18T08:00:00Z"));
		await q.flushQueue();
		expect(complete.mock.calls[0]?.[1]).toBe("2026-11-17");
		vi.useRealTimers();
	});

	it("annuler une validation encore en file la retire sans rien envoyer", async () => {
		complete.mockRejectedValue(new TypeError("offline"));
		const q = await fresh();
		await q.enqueueCompletion("a", "2026-11-17");
		await q.enqueueCompletion("a", "2026-11-17");
		await q.flushQueue();
		expect(await q.dequeueLast("a", "2026-11-17")).toBe(true);
		expect(q.queuedFor("a", "2026-11-17")).toHaveLength(1);
		expect(await q.dequeueLast("zzz", "2026-11-17")).toBe(false);
	});
});
