// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
	default: { getItem: async () => null, setItem: async () => undefined },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const { verifyServer, ServerError } = await import("./server.js");

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
	fetchMock.mockReset();
});

describe("verifyServer", () => {
	it("accepte un serveur Lumo et appelle /api/v1/auth/config", async () => {
		fetchMock.mockResolvedValue(json({ app: "lumo", oidc: false, local: true, setupRequired: false }));
		const cfg = await verifyServer("https://lumo.example.org");
		expect(cfg.local).toBe(true);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://lumo.example.org/api/v1/auth/config");
	});

	it("refuse une réponse qui n'est pas Lumo (JSON étranger ou page HTML)", async () => {
		fetchMock.mockResolvedValue(json({ hello: "world" }));
		await expect(verifyServer("https://x.test")).rejects.toMatchObject({ code: "not_lumo" });
		fetchMock.mockResolvedValue(new Response("<html></html>", { status: 200 }));
		await expect(verifyServer("https://x.test")).rejects.toMatchObject({ code: "not_lumo" });
		fetchMock.mockResolvedValue(json({ title: "Not found" }, 404));
		await expect(verifyServer("https://x.test")).rejects.toBeInstanceOf(ServerError);
	});

	it("serveur injoignable : erreur réseau ou délai dépassé", async () => {
		fetchMock.mockRejectedValue(new TypeError("Network request failed"));
		await expect(verifyServer("https://x.test")).rejects.toMatchObject({ code: "unreachable" });
		fetchMock.mockReturnValue(new Promise(() => undefined));
		await expect(verifyServer("https://x.test", 20)).rejects.toMatchObject({ code: "unreachable" });
	});
});
