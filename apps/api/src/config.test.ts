// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
	DATABASE_PATH: "/data/lumo.db",
	PUBLIC_URL: "https://lumo.example.org",
	SESSION_SECRET: "s".repeat(32),
};

describe("loadConfig", () => {
	it("accepte une config minimale (comptes locaux seuls)", () => {
		const c = loadConfig(base);
		expect(c).toMatchObject({ PORT: 3000, LOCAL_AUTH_ENABLED: true, oidcEnabled: false, secureCookies: true });
	});

	it("active OIDC quand les trois variables sont fournies", () => {
		const c = loadConfig({
			...base,
			OIDC_ISSUER: "https://auth.example.org/application/o/lumo/",
			OIDC_CLIENT_ID: "lumo",
			OIDC_CLIENT_SECRET: "x",
		});
		expect(c.oidcEnabled).toBe(true);
	});

	it("refuse une config OIDC partielle", () => {
		expect(() => loadConfig({ ...base, OIDC_ISSUER: "https://auth.example.org/" })).toThrow(/vont ensemble/);
	});

	it("refuse de démarrer sans aucune méthode de connexion", () => {
		expect(() => loadConfig({ ...base, LOCAL_AUTH_ENABLED: "false" })).toThrow(/Aucune méthode de connexion/);
	});

	it("refuse un secret de session trop court et une URL invalide", () => {
		expect(() => loadConfig({ ...base, SESSION_SECRET: "court" })).toThrow(/SESSION_SECRET/);
		expect(() => loadConfig({ ...base, PUBLIC_URL: "pas-une-url" })).toThrow(/PUBLIC_URL/);
	});

	it("n'impose pas Secure aux cookies en http local", () => {
		expect(loadConfig({ ...base, PUBLIC_URL: "http://localhost:3000" }).secureCookies).toBe(false);
	});

	it("exige DATABASE_PATH", () => {
		const { DATABASE_PATH: _omit, ...rest } = base;
		expect(() => loadConfig(rest)).toThrow(/DATABASE_PATH/);
	});
});
