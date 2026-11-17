// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { SESSION_COOKIE } from "../auth/guard.js";
import type { OidcClaims, OidcProvider } from "../auth/oidc.js";
import { type Config, loadConfig } from "../config.js";
import { type Db, openDatabase } from "../db/client.js";

export const PUBLIC_URL = "https://lumo.test";

/** Faux Authentik : `code` → claims ; vérifie le state et le nonce comme le ferait le vrai client. */
export class FakeOidc implements OidcProvider {
	readonly claimsByCode = new Map<string, OidcClaims>();
	lastExchange: { codeVerifier: string; expectedState: string | null; expectedNonce: string } | null = null;

	async buildAuthorizationUrl(p: { redirectUri: string; state: string; nonce: string; codeChallenge: string }) {
		const url = new URL("https://idp.test/authorize");
		url.searchParams.set("redirect_uri", p.redirectUri);
		url.searchParams.set("state", p.state);
		url.searchParams.set("nonce", p.nonce);
		url.searchParams.set("code_challenge", p.codeChallenge);
		return url.href;
	}

	async exchange(p: { callbackUrl: URL; codeVerifier: string; expectedState: string | null; expectedNonce: string }) {
		this.lastExchange = {
			codeVerifier: p.codeVerifier,
			expectedState: p.expectedState,
			expectedNonce: p.expectedNonce,
		};
		if (p.expectedState !== null && p.callbackUrl.searchParams.get("state") !== p.expectedState) {
			throw new Error("state invalide");
		}
		const claims = this.claimsByCode.get(p.callbackUrl.searchParams.get("code") ?? "");
		if (!claims) throw new Error("code invalide");
		return claims;
	}

	grant(code: string, claims: Partial<OidcClaims> & { sub: string }) {
		this.claimsByCode.set(code, { name: "Test", email: null, picture: null, groups: [], ...claims });
	}
}

export interface TestContext {
	app: FastifyInstance;
	db: Db;
	sqlite: Database.Database;
	config: Config;
	oidc: FakeOidc;
	dbPath: string;
	close: () => Promise<void>;
}

/** Application complète sur un fichier SQLite temporaire (un par test). */
export async function createTestContext(env: Record<string, string> = {}): Promise<TestContext> {
	const dir = mkdtempSync(join(tmpdir(), "lumo-test-"));
	const dbPath = join(dir, "lumo.db");
	const config = loadConfig({
		DATABASE_PATH: dbPath,
		PUBLIC_URL,
		SESSION_SECRET: "x".repeat(40),
		OIDC_ISSUER: "https://idp.test/application/o/lumo/",
		OIDC_CLIENT_ID: "lumo",
		OIDC_CLIENT_SECRET: "secret",
		NODE_ENV: "test",
		...env,
	});
	const { db, sqlite } = openDatabase(dbPath);
	const oidc = new FakeOidc();
	const app = await buildApp({ config, db, oidc: config.oidcEnabled ? oidc : null });
	await app.ready();
	return {
		app,
		db,
		sqlite,
		config,
		oidc,
		dbPath,
		close: async () => {
			await app.close();
			sqlite.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

export const ORIGIN = { origin: PUBLIC_URL };

export function sessionCookie(res: { cookies: { name: string; value: string }[] }): string | null {
	return res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null;
}

export const cookieHeader = (value: string) => ({ cookie: `${SESSION_COOKIE}=${value}` });

export const OWNER = {
	householdName: "Les Dupont",
	displayName: "Alice",
	username: "alice",
	password: "correct-horse-battery",
};

/** Initialise l'instance (compte local owner) et renvoie son cookie web. */
export async function setupOwner(ctx: TestContext): Promise<string> {
	const res = await ctx.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: OWNER });
	if (res.statusCode !== 201) throw new Error(`setup a échoué : ${res.body}`);
	return sessionCookie(res) as string;
}
