// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
	DATABASE_PATH: "/data/lumo.db",
	PUBLIC_URL: "https://lumo.example.org",
	SESSION_SECRET: "s".repeat(32),
};

describe("loadConfig", () => {
	it("accepts a minimal config (local accounts only)", () => {
		const c = loadConfig(base);
		expect(c).toMatchObject({ PORT: 3000, LOCAL_AUTH_ENABLED: true, oidcEnabled: false, secureCookies: true });
	});

	it("enables OIDC when all three variables are provided", () => {
		const c = loadConfig({
			...base,
			OIDC_ISSUER: "https://auth.example.org/application/o/lumo/",
			OIDC_CLIENT_ID: "lumo",
			OIDC_CLIENT_SECRET: "x",
		});
		expect(c.oidcEnabled).toBe(true);
	});

	it("rejects a partial OIDC config", () => {
		expect(() => loadConfig({ ...base, OIDC_ISSUER: "https://auth.example.org/" })).toThrow(/go together/);
	});

	it("refuses to start without any sign-in method", () => {
		expect(() => loadConfig({ ...base, LOCAL_AUTH_ENABLED: "false" })).toThrow(/No sign-in method/);
	});

	it("rejects a session secret that is too short and an invalid URL", () => {
		expect(() => loadConfig({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
		expect(() => loadConfig({ ...base, PUBLIC_URL: "not-a-url" })).toThrow(/PUBLIC_URL/);
	});

	it("does not force Secure cookies on local http", () => {
		expect(loadConfig({ ...base, PUBLIC_URL: "http://localhost:3000" }).secureCookies).toBe(false);
	});

	it("exige DATABASE_PATH", () => {
		const { DATABASE_PATH: _omit, ...rest } = base;
		expect(() => loadConfig(rest)).toThrow(/DATABASE_PATH/);
	});
});
