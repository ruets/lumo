// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { isLocalHost, normalizeServerUrl } from "./serverUrl.js";

const ok = (url: string) => ({ ok: true, url });

describe("normalizeServerUrl", () => {
	it("ajoute https:// à une adresse nue et retire slash final, requête et ancre", () => {
		expect(normalizeServerUrl("lumo.example.org")).toEqual(ok("https://lumo.example.org"));
		expect(normalizeServerUrl("  https://lumo.example.org/?a=1#x ")).toEqual(ok("https://lumo.example.org"));
		expect(normalizeServerUrl("https://example.org/lumo/")).toEqual(ok("https://example.org/lumo"));
	});

	it("garde le port", () => {
		expect(normalizeServerUrl("https://lumo.example.org:8443")).toEqual(ok("https://lumo.example.org:8443"));
	});

	it("une adresse locale nue passe en http, une adresse publique reste en https", () => {
		expect(normalizeServerUrl("localhost:3000")).toEqual(ok("http://localhost:3000"));
		expect(normalizeServerUrl("192.168.1.20:3000")).toEqual(ok("http://192.168.1.20:3000"));
		expect(normalizeServerUrl("lumo.local")).toEqual(ok("http://lumo.local"));
	});

	it("refuse le http en clair vers une adresse publique", () => {
		expect(normalizeServerUrl("http://lumo.example.org")).toEqual({ ok: false, reason: "insecure" });
		expect(normalizeServerUrl("http://8.8.8.8")).toEqual({ ok: false, reason: "insecure" });
	});

	it("refuse le vide et ce qui n'est pas une adresse web", () => {
		expect(normalizeServerUrl("   ")).toEqual({ ok: false, reason: "empty" });
		expect(normalizeServerUrl("ftp://example.org")).toEqual({ ok: false, reason: "invalid" });
		expect(normalizeServerUrl("https://")).toEqual({ ok: false, reason: "invalid" });
	});
});

describe("isLocalHost", () => {
	it("reconnaît le réseau privé et rien d'autre", () => {
		for (const h of ["localhost", "127.0.0.1", "10.0.2.2", "192.168.0.5", "172.16.0.1", "172.31.255.1", "foo.local"])
			expect(isLocalHost(h)).toBe(true);
		for (const h of ["172.32.0.1", "172.15.0.1", "8.8.8.8", "example.org", "192.169.0.1"])
			expect(isLocalHost(h)).toBe(false);
	});
});
