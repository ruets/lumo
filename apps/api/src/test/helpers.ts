// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../app.js";
import { SESSION_COOKIE } from "../auth/guard.js";
import type { OidcClaims, OidcProvider } from "../auth/oidc.js";
import { type Config, loadConfig } from "../config.js";
import { type Db, openDatabase } from "../db/client.js";

export const PUBLIC_URL = "https://lumo.test";

/** Fake Authentik: `code` → claims; checks state and nonce like the real client would. */
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
	/** Controlled clock: `ctx.clock.now = new Date(...)` moves the app's time forward. */
	clock: { now: Date };
	app: FastifyInstance;
	db: Db;
	sqlite: Database.Database;
	config: Config;
	oidc: FakeOidc;
	dbPath: string;
	close: () => Promise<void>;
}

/** Full application on a temporary SQLite file (one per test). */
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
		OIDC_ADMIN_GROUP: "lumo-admins",
		NODE_ENV: "test",
		...env,
	});
	const { db, sqlite } = openDatabase(dbPath);
	const oidc = new FakeOidc();
	// Nov 17, 2026, 11:00 in Paris (a Tuesday).
	const clock = { now: new Date("2026-11-17T10:00:00Z") };
	const app = await buildApp({ config, db, oidc: config.oidcEnabled ? oidc : null, clock: () => clock.now });
	await app.ready();
	return {
		clock,
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
	householdName: "The Smiths",
	displayName: "Alice",
	username: "alice",
	password: "correct-horse-battery",
};

/** Sets up the instance (local owner account) and returns its web cookie. */
export async function setupOwner(ctx: TestContext): Promise<string> {
	const res = await ctx.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: OWNER });
	if (res.statusCode !== 201) throw new Error(`setup failed : ${res.body}`);
	return sessionCookie(res) as string;
}

/** Cookie-authenticated HTTP client: origin and `Idempotency-Key` (a fresh UUID per call) added. */
export interface Api {
	get(url: string): Promise<LightMyRequestResponse>;
	post(url: string, payload?: unknown, extra?: Record<string, string>): Promise<LightMyRequestResponse>;
	patch(url: string, payload?: unknown): Promise<LightMyRequestResponse>;
	del(url: string): Promise<LightMyRequestResponse>;
}

export function api(ctx: { app: FastifyInstance }, cookie: string): Api {
	const call = (
		method: "GET" | "POST" | "PATCH" | "DELETE",
		url: string,
		payload?: unknown,
		extra: Record<string, string> = {},
	) =>
		ctx.app.inject({
			method,
			url: `/api/v1${url}`,
			...(payload === undefined ? {} : { payload: payload as object }),
			headers: { ...cookieHeader(cookie), ...ORIGIN, "idempotency-key": randomUUID(), ...extra },
		});
	return {
		get: (url: string) => call("GET", url),
		post: (url: string, payload: unknown = {}, extra?: Record<string, string>) => call("POST", url, payload, extra),
		patch: (url: string, payload: unknown = {}) => call("PATCH", url, payload),
		del: (url: string) => call("DELETE", url),
	};
}

/** Creates a member (invitation + local account) and returns their cookie and id. */
export interface Member {
	cookie: string;
	userId: string;
	api: Api;
}

export async function addMember(
	ctx: TestContext,
	ownerCookie: string,
	role: "adult" | "child",
	username: string,
): Promise<Member> {
	const invite = await ctx.app.inject({
		method: "POST",
		url: "/api/v1/household/invites",
		payload: { role },
		headers: { ...cookieHeader(ownerCookie), ...ORIGIN },
	});
	const res = await ctx.app.inject({
		method: "POST",
		url: "/api/v1/auth/local/register",
		payload: { invite: invite.json().token, displayName: username, username, password: "a-long-password-here" },
	});
	if (res.statusCode !== 201) throw new Error(`register failed : ${res.body}`);
	const cookie = sessionCookie(res) as string;
	const me = await ctx.app.inject({ url: "/api/v1/me", headers: cookieHeader(cookie) });
	return { cookie, userId: me.json().user.id as string, api: api(ctx, cookie) };
}

/** Test household: alice (owner), bob (adult), kid (child). */
export async function createHousehold(ctx: TestContext): Promise<{ owner: Member; adult: Member; kid: Member }> {
	const ownerCookie = await setupOwner(ctx);
	const meRes = await ctx.app.inject({ url: "/api/v1/me", headers: cookieHeader(ownerCookie) });
	const owner: Member = { cookie: ownerCookie, userId: meRes.json().user.id as string, api: api(ctx, ownerCookie) };
	const adult = await addMember(ctx, ownerCookie, "adult", "bob");
	const kid = await addMember(ctx, ownerCookie, "child", "kid");
	return { owner, adult, kid };
}

export async function balances(member: { api: Api }) {
	const me = (await member.api.get("/me")).json();
	return { personal: me.wallets.personal.balance as number, shared: me.wallets.shared.balance as number };
}

/** Default daily habit, created through the API. */
export async function makeHabit(by: { api: Api }, over: Record<string, unknown> = {}) {
	const res = await by.api.post("/items", {
		kind: "habit",
		name: "Drink water",
		schedule: { type: "daily" },
		reward: 5,
		...over,
	});
	if (res.statusCode !== 201) throw new Error(`habit creation refused : ${res.body}`);
	return res.json() as { id: string; assigneeIds: string[] };
}
