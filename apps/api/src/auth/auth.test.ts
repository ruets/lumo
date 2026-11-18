// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memberships, sessions, users } from "../db/schema.js";
import {
	cookieHeader,
	createTestContext,
	ORIGIN,
	OWNER,
	sessionCookie,
	setupOwner,
	type TestContext,
} from "../test/helpers.js";
import { createInvite } from "./invites.js";

let ctx: TestContext;
beforeEach(async () => {
	ctx = await createTestContext();
});
afterEach(async () => {
	await ctx.close();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
	ctx.app.inject({ method: "POST", url: `/api/v1${url}`, payload: payload as object, headers });
const get = (url: string, headers: Record<string, string> = {}) =>
	ctx.app.inject({ method: "GET", url: `/api/v1${url}`, headers });

async function ownerId() {
	return ctx.db.select().from(users).where(eq(users.username, "alice")).get()?.id as string;
}

describe("fresh instance", () => {
	it("announces that setup is required, then no longer", async () => {
		expect((await get("/auth/config")).json()).toMatchObject({ oidc: true, local: true, setupRequired: true });
		await setupOwner(ctx);
		expect((await get("/auth/config")).json().setupRequired).toBe(false);
	});

	it("creates the household, the owner, their wallet and the shared pot", async () => {
		const cookie = await setupOwner(ctx);
		const me = (await get("/me", cookieHeader(cookie))).json();
		expect(me.user.displayName).toBe("Alice");
		expect(me.household.name).toBe("The Smiths");
		expect(me.role).toBe("owner");
		expect(me.wallets.personal.balance).toBe(0);
		expect(me.wallets.shared.balance).toBe(0);
		expect(me.wallets.personal.id).not.toBe(me.wallets.shared.id);
	});

	it("refuse un second setup", async () => {
		await setupOwner(ctx);
		const res = await post("/auth/setup", { ...OWNER, username: "bob" });
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("setup_done");
	});

	it("rejects a password that is too short", async () => {
		const res = await post("/auth/setup", { ...OWNER, password: "short" });
		expect(res.statusCode).toBe(400);
		expect(res.headers["content-type"]).toContain("application/problem+json");
		expect(res.json().code).toBe("validation_error");
	});

	it("never stores the password in plain text", async () => {
		await setupOwner(ctx);
		const row = ctx.db.select().from(users).where(eq(users.username, "alice")).get();
		expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
		expect(JSON.stringify(row)).not.toContain(OWNER.password);
	});
});

describe("connexion locale", () => {
	beforeEach(async () => {
		await setupOwner(ctx);
	});

	it("rejects a wrong password and an unknown username with the same error", async () => {
		const bad = await post("/auth/local/login", { username: "alice", password: "wrong-password-here" });
		const unknown = await post("/auth/local/login", { username: "zoe", password: OWNER.password });
		expect(bad.statusCode).toBe(401);
		expect(unknown.statusCode).toBe(401);
		expect(bad.json().code).toBe("invalid_credentials");
		expect(unknown.json()).toMatchObject({ code: "invalid_credentials", title: bad.json().title });
	});

	it("web : pose un cookie HttpOnly Secure SameSite=Lax", async () => {
		const res = await post("/auth/local/login", { username: "Alice", password: OWNER.password });
		expect(res.statusCode).toBe(200);
		const cookie = res.cookies.find((c) => c.name === "lumo_session");
		expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
		expect(res.body).not.toContain(cookie?.value as string);
	});

	it("mobile: returns access and refresh tokens, usable as Bearer", async () => {
		const res = await post("/auth/local/login", { username: "alice", password: OWNER.password, client: "mobile" });
		const tokens = res.json();
		expect(tokens.expiresIn).toBe(900);
		const me = await get("/me", { authorization: `Bearer ${tokens.accessToken}` });
		expect(me.statusCode).toBe(200);
		expect(me.json().user.displayName).toBe("Alice");
	});

	it("blocks brute force (429 beyond 10 attempts per minute)", async () => {
		let last = 0;
		for (let i = 0; i < 12; i++) {
			last = (await post("/auth/local/login", { username: "alice", password: "faux-faux-faux" })).statusCode;
		}
		expect(last).toBe(429);
	});
});

describe("local accounts disabled", () => {
	it("answers 404 on the local routes", async () => {
		await ctx.close();
		ctx = await createTestContext({ LOCAL_AUTH_ENABLED: "false" });
		const res = await post("/auth/local/login", { username: "alice", password: OWNER.password });
		expect(res.statusCode).toBe(404);
		expect(res.json().code).toBe("local_auth_disabled");
		expect((await get("/auth/config")).json()).toMatchObject({ local: false, setupRequired: false });
	});
});

describe("sessions and protected access", () => {
	it("rejects /me without authentication, or with a bogus token", async () => {
		expect((await get("/me")).statusCode).toBe(401);
		expect((await get("/me", { authorization: "Bearer n-importe-quoi" })).statusCode).toBe(401);
		expect((await get("/me", cookieHeader("inconnu"))).statusCode).toBe(401);
	});

	it("rejects a token signed with another secret", async () => {
		const { signAccessToken } = await import("./tokens.js");
		const forged = await signAccessToken("y".repeat(40), { userId: await ownerIdAfterSetup(), sessionId: "s" });
		expect((await get("/me", { authorization: `Bearer ${forged}` })).statusCode).toBe(401);
	});

	async function ownerIdAfterSetup() {
		await setupOwner(ctx);
		return ownerId();
	}

	it("sign-out: requires the site origin with a cookie (CSRF), then revokes the session", async () => {
		const cookie = await setupOwner(ctx);
		const noOrigin = await post("/auth/logout", {}, cookieHeader(cookie));
		expect(noOrigin.statusCode).toBe(403);
		const evil = await post("/auth/logout", {}, { ...cookieHeader(cookie), origin: "https://evil.test" });
		expect(evil.statusCode).toBe(403);

		const ok = await post("/auth/logout", {}, { ...cookieHeader(cookie), ...ORIGIN });
		expect(ok.statusCode).toBe(204);
		expect((await get("/me", cookieHeader(cookie))).statusCode).toBe(401);
	});

	it("mobile sign-out: the access token stops working", async () => {
		await setupOwner(ctx);
		const tokens = (
			await post("/auth/local/login", { username: "alice", password: OWNER.password, client: "mobile" })
		).json();
		const auth = { authorization: `Bearer ${tokens.accessToken}` };
		expect((await post("/auth/logout", {}, auth)).statusCode).toBe(204);
		expect((await get("/me", auth)).statusCode).toBe(401);
	});

	it("expired session: rejected", async () => {
		const cookie = await setupOwner(ctx);
		ctx.db
			.update(sessions)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.run();
		expect((await get("/me", cookieHeader(cookie))).statusCode).toBe(401);
	});
});

describe("refresh token rotatif", () => {
	async function mobileLogin() {
		await setupOwner(ctx);
		return (
			await post("/auth/local/login", { username: "alice", password: OWNER.password, client: "mobile" })
		).json() as {
			accessToken: string;
			refreshToken: string;
		};
	}

	it("issues new tokens and invalidates the old refresh token", async () => {
		const first = await mobileLogin();
		const res = await post("/auth/refresh", { refreshToken: first.refreshToken });
		expect(res.statusCode).toBe(200);
		const second = res.json();
		expect(second.refreshToken).not.toBe(first.refreshToken);
		expect((await get("/me", { authorization: `Bearer ${second.accessToken}` })).statusCode).toBe(200);
		expect((await post("/auth/refresh", { refreshToken: second.refreshToken })).statusCode).toBe(200);
	});

	it("revokes the whole session if an old refresh token is replayed", async () => {
		const first = await mobileLogin();
		const second = (await post("/auth/refresh", { refreshToken: first.refreshToken })).json();
		// Replay of the already used token (likely theft): rejected, and the whole session is revoked.
		expect((await post("/auth/refresh", { refreshToken: first.refreshToken })).statusCode).toBe(401);
		expect((await post("/auth/refresh", { refreshToken: second.refreshToken })).statusCode).toBe(401);
		expect((await get("/me", { authorization: `Bearer ${second.accessToken}` })).statusCode).toBe(401);
	});

	it("rejects a web cookie used as a refresh token", async () => {
		const cookie = await setupOwner(ctx);
		expect((await post("/auth/refresh", { refreshToken: cookie })).statusCode).toBe(401);
	});

	it("stores only hashes", async () => {
		const first = await mobileLogin();
		const rows = ctx.db.select().from(sessions).all();
		expect(JSON.stringify(rows)).not.toContain(first.refreshToken);
	});
});

describe("invitations and local accounts", () => {
	async function invite(role: "member" | "child", cookie: string) {
		const res = await post("/household/invites", { role }, { ...cookieHeader(cookie), ...ORIGIN });
		expect(res.statusCode).toBe(201);
		return res.json().token as string;
	}

	it("rejects account creation without a valid invitation", async () => {
		await setupOwner(ctx);
		const res = await post("/auth/local/register", {
			invite: "jeton-inexistant-123",
			displayName: "Bob",
			username: "bob",
			password: "a-long-password-here",
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("invalid_invite");
	});

	it("creates a member with the invitation's role and their wallet, and burns the invitation", async () => {
		const owner = await setupOwner(ctx);
		const token = await invite("member", owner);
		const res = await post("/auth/local/register", {
			invite: token,
			displayName: "Bob",
			username: "bob",
			password: "a-long-password-here",
		});
		expect(res.statusCode).toBe(201);
		const me = (await get("/me", cookieHeader(sessionCookie(res) as string))).json();
		expect(me.role).toBe("member");
		expect(me.household.name).toBe("The Smiths");
		expect(me.wallets.personal.id).toBeTruthy();

		const again = await post("/auth/local/register", {
			invite: token,
			displayName: "Eve",
			username: "eve",
			password: "a-long-password-here",
		});
		expect(again.json().code).toBe("invalid_invite");
	});

	it("rejects an expired invitation", async () => {
		await setupOwner(ctx);
		const household = ctx.db.select().from(memberships).get();
		const { token } = createInvite(ctx.db, {
			householdId: household?.householdId as string,
			role: "member",
			createdBy: await ownerId(),
			now: new Date(Date.now() - 8 * 24 * 3600 * 1000),
		});
		const res = await post("/auth/local/register", {
			invite: token,
			displayName: "Bob",
			username: "bob",
			password: "a-long-password-here",
		});
		expect(res.json().code).toBe("invalid_invite");
	});

	it("rejects a username already taken, without consuming the invitation", async () => {
		const owner = await setupOwner(ctx);
		const token = await invite("member", owner);
		const clash = await post("/auth/local/register", {
			invite: token,
			displayName: "Autre",
			username: "alice",
			password: "a-long-password-here",
		});
		expect(clash.statusCode).toBe(409);
		const ok = await post("/auth/local/register", {
			invite: token,
			displayName: "Bob",
			username: "bob",
			password: "a-long-password-here",
		});
		expect(ok.statusCode).toBe(201);
	});

	it("only an owner can invite", async () => {
		const owner = await setupOwner(ctx);
		const token = await invite("member", owner);
		const adult = await post("/auth/local/register", {
			invite: token,
			displayName: "Bob",
			username: "bob",
			password: "a-long-password-here",
		});
		const res = await post(
			"/household/invites",
			{ role: "member" },
			{ ...cookieHeader(sessionCookie(adult) as string), ...ORIGIN },
		);
		expect(res.statusCode).toBe(403);
		expect(
			(await post("/household/invites", { role: "child" }, { ...cookieHeader(owner), ...ORIGIN })).statusCode,
		).toBe(400); // the old child role no longer exists
	});
});

describe("OIDC web (Authentik)", () => {
	async function startLogin(invite?: string) {
		const res = await get(`/auth/login${invite ? `?invite=${invite}` : ""}`);
		expect(res.statusCode).toBe(302);
		const url = new URL(res.headers.location as string);
		return { state: url.searchParams.get("state") as string, url };
	}
	const callback = (state: string, code: string) => get(`/auth/callback?code=${code}&state=${state}`);

	it("redirects to Authentik with state, nonce and PKCE S256", async () => {
		const { url } = await startLogin();
		expect(url.origin).toBe("https://idp.test");
		expect(url.searchParams.get("redirect_uri")).toBe("https://lumo.test/api/v1/auth/callback");
		expect(url.searchParams.get("state")).toBeTruthy();
		expect(url.searchParams.get("nonce")).toBeTruthy();
		expect(url.searchParams.get("code_challenge")).toBeTruthy();
	});

	it("first user of the instance: becomes owner of a new household", async () => {
		ctx.oidc.grant("c1", { sub: "sub-1", name: "Alice Authentik" });
		const { state } = await startLogin();
		const res = await callback(state, "c1");
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe("https://lumo.test/");
		const me = (await get("/me", cookieHeader(sessionCookie(res) as string))).json();
		expect(me).toMatchObject({ role: "owner", user: { displayName: "Alice Authentik" } });
	});

	it("recognises a known user by their sub, without duplicates", async () => {
		ctx.oidc.grant("c1", { sub: "sub-1" });
		ctx.oidc.grant("c2", { sub: "sub-1" });
		await callback((await startLogin()).state, "c1");
		await callback((await startLogin()).state, "c2");
		expect(ctx.db.select().from(users).all()).toHaveLength(1);
	});

	it("rejects a stranger without an invitation once the instance is set up", async () => {
		await setupOwner(ctx);
		ctx.oidc.grant("c1", { sub: "intrus" });
		const res = await callback((await startLogin()).state, "c1");
		expect(res.headers.location).toBe("https://lumo.test/?auth_error=invitation_required");
		expect(sessionCookie(res)).toBeNull();
		expect(ctx.db.select().from(users).all()).toHaveLength(1);
	});

	it("creates a guest's account and links their sub", async () => {
		const owner = await setupOwner(ctx);
		const token = (await post("/household/invites", { role: "member" }, { ...cookieHeader(owner), ...ORIGIN })).json()
			.token;
		ctx.oidc.grant("c1", { sub: "sub-bob", name: "Bob" });
		const res = await callback((await startLogin(token)).state, "c1");
		const me = (await get("/me", cookieHeader(sessionCookie(res) as string))).json();
		expect(me).toMatchObject({ role: "member", household: { name: "The Smiths" } });
		// The sub is now linked: the same invitation no longer works, but Bob signs back in without it.
		ctx.oidc.grant("c2", { sub: "sub-bob" });
		const again = await callback((await startLogin()).state, "c2");
		expect(sessionCookie(again)).toBeTruthy();
	});

	it("lumo-admins group: makes a super admin, never demotes", async () => {
		const owner = await setupOwner(ctx);
		const token = (await post("/household/invites", { role: "member" }, { ...cookieHeader(owner), ...ORIGIN })).json()
			.token;
		ctx.oidc.grant("c1", { sub: "sub-bob" });
		await callback((await startLogin(token)).state, "c1");
		const admins = () => ctx.db.select().from(users).where(eq(users.isSuperAdmin, true)).all().length;
		expect(admins()).toBe(1);

		ctx.oidc.grant("c2", { sub: "sub-bob", groups: ["lumo-admins"] });
		await callback((await startLogin()).state, "c2");
		expect(admins()).toBe(2);

		ctx.oidc.grant("c3", { sub: "sub-bob", groups: [] });
		await callback((await startLogin()).state, "c3");
		expect(admins()).toBe(2);
	});

	it("without OIDC_ADMIN_GROUP nobody becomes super admin from their groups", async () => {
		await ctx.close();
		ctx = await createTestContext({ OIDC_ADMIN_GROUP: "" });
		const owner = await setupOwner(ctx);
		const token = (await post("/household/invites", { role: "member" }, { ...cookieHeader(owner), ...ORIGIN })).json()
			.token;
		ctx.oidc.grant("c1", { sub: "sub-bob", groups: ["lumo-admins"] });
		await callback((await startLogin(token)).state, "c1");
		ctx.oidc.grant("c2", { sub: "sub-bob", groups: ["lumo-admins"] });
		await callback((await startLogin()).state, "c2");
		expect(ctx.db.select().from(users).where(eq(users.isSuperAdmin, true)).all()).toHaveLength(1);
	});

	it("the state is single-use and mandatory", async () => {
		ctx.oidc.grant("c1", { sub: "sub-1" });
		const { state } = await startLogin();
		expect((await callback(state, "c1")).headers.location).toBe("https://lumo.test/");
		expect((await callback(state, "c1")).headers.location).toBe("https://lumo.test/?auth_error=oidc_failed");
		expect((await callback("state-inconnu", "c1")).headers.location).toBe("https://lumo.test/?auth_error=oidc_failed");
		expect((await get("/auth/callback?code=c1")).headers.location).toBe("https://lumo.test/?auth_error=oidc_failed");
	});

	it("an invalid code fails cleanly, without a session", async () => {
		const { state } = await startLogin();
		const res = await callback(state, "code-inconnu");
		expect(res.headers.location).toBe("https://lumo.test/?auth_error=oidc_failed");
		expect(sessionCookie(res)).toBeNull();
	});

	it("GET /auth/config identifies as Lumo and gives issuer and client_id, never the secret", async () => {
		const res = await get("/auth/config");
		expect(res.json()).toMatchObject({
			app: "lumo",
			oidc: true,
			oidcIssuer: "https://idp.test/application/o/lumo/",
			oidcClientId: "lumo",
		});
		expect(res.body).not.toContain("secret");
		await ctx.close();
		ctx = await createTestContext({ OIDC_ISSUER: "", OIDC_CLIENT_ID: "", OIDC_CLIENT_SECRET: "" });
		expect((await get("/auth/config")).json()).toMatchObject({ oidc: false, oidcIssuer: null, oidcClientId: null });
	});

	it("is unavailable if OIDC is not configured", async () => {
		await ctx.close();
		ctx = await createTestContext({ OIDC_ISSUER: "", OIDC_CLIENT_ID: "", OIDC_CLIENT_SECRET: "" });
		expect((await get("/auth/login")).statusCode).toBe(404);
	});
});

describe("OIDC mobile (expo-auth-session)", () => {
	const body = (over: Record<string, unknown> = {}) => ({
		code: "m1",
		codeVerifier: "v".repeat(50),
		redirectUri: "lumo://auth",
		nonce: "n-123",
		state: "s-123",
		...over,
	});

	it("exchanges the code for a token pair, passing PKCE and nonce", async () => {
		ctx.oidc.grant("m1", { sub: "sub-m", name: "Mobile" });
		const res = await post("/auth/mobile/exchange", body());
		expect(res.statusCode).toBe(200);
		expect(ctx.oidc.lastExchange).toMatchObject({ codeVerifier: "v".repeat(50), expectedNonce: "n-123" });
		const { accessToken } = res.json();
		expect((await get("/me", { authorization: `Bearer ${accessToken}` })).json().role).toBe("owner");
	});

	it("rejects a stranger without an invitation", async () => {
		await setupOwner(ctx);
		ctx.oidc.grant("m1", { sub: "intrus" });
		const res = await post("/auth/mobile/exchange", body());
		expect(res.statusCode).toBe(403);
		expect(res.json().code).toBe("invitation_required");
	});

	it("accepts an invitation", async () => {
		const owner = await setupOwner(ctx);
		const token = (await post("/household/invites", { role: "member" }, { ...cookieHeader(owner), ...ORIGIN })).json()
			.token;
		ctx.oidc.grant("m1", { sub: "sub-kid" });
		const res = await post("/auth/mobile/exchange", body({ invite: token }));
		expect((await get("/me", { authorization: `Bearer ${res.json().accessToken}` })).json().role).toBe("member");
	});

	it("returns oidc_failed if Authentik rejects the code", async () => {
		const res = await post("/auth/mobile/exchange", body({ code: "faux" }));
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("oidc_failed");
	});
});

describe("divers", () => {
	it("exposes /healthz and /readyz", async () => {
		expect((await ctx.app.inject({ url: "/healthz" })).json()).toEqual({ status: "ok" });
		expect((await ctx.app.inject({ url: "/readyz" })).statusCode).toBe(200);
	});

	it("returns 404s as problem+json", async () => {
		const res = await get("/inexistant");
		expect(res.statusCode).toBe(404);
		expect(res.headers["content-type"]).toContain("application/problem+json");
	});
});

describe("linking an OIDC identity to a signed-in account", () => {
	const PASSWORD = "a-long-password-here";

	/** alice (super admin) and a local member bob, signed in. */
	async function members() {
		const owner = await setupOwner(ctx);
		const invite = (await post("/household/invites", { role: "member" }, { ...cookieHeader(owner), ...ORIGIN })).json()
			.token;
		const bob = await post("/auth/local/register", {
			invite,
			displayName: "Bob",
			username: "bob",
			password: PASSWORD,
		});
		return { owner, bob: sessionCookie(bob) as string };
	}
	const link = async (cookie: string, code: string, sub: string) => {
		ctx.oidc.grant(code, { sub, name: "Bob From Authentik", email: "bob@example.org" });
		const start = await get("/auth/link", cookieHeader(cookie));
		expect(start.statusCode).toBe(302);
		const state = new URL(start.headers.location as string).searchParams.get("state") as string;
		return get(`/auth/callback?code=${code}&state=${state}`);
	};
	const bobRow = () => ctx.db.select().from(users).where(eq(users.username, "bob")).get();

	it("links the identity to the account, which keeps its name, password and household", async () => {
		const { bob } = await members();
		const res = await link(bob, "l1", "sub-bob");
		expect(res.headers.location).toBe("https://lumo.test/settings?linked=1");
		expect(bobRow()).toMatchObject({ displayName: "Bob", oidcSubject: "sub-bob", email: "bob@example.org" });
		expect(bobRow()?.oidcIssuer).toBe(ctx.config.OIDC_ISSUER);
		expect(bobRow()?.passwordHash).not.toBeNull();
		expect((await get("/account", cookieHeader(bob))).json().oidc).toBe(true);
	});

	it("the identity then signs in to that same account", async () => {
		const { bob } = await members();
		await link(bob, "l1", "sub-bob");
		ctx.oidc.grant("l2", { sub: "sub-bob" });
		const login = await get("/auth/login");
		const state = new URL(login.headers.location as string).searchParams.get("state") as string;
		const res = await get(`/auth/callback?code=l2&state=${state}`);
		expect(res.headers.location).toBe("https://lumo.test/");
		const me = await get("/me", cookieHeader(sessionCookie(res) as string));
		expect(me.json().user.displayName).toBe("Bob");
		expect(ctx.db.select().from(users).all()).toHaveLength(2);
	});

	it("requires being signed in", async () => {
		expect((await get("/auth/link")).statusCode).toBe(401);
	});

	it("refuses an account that already has an identity, and an identity that belongs to someone else", async () => {
		const { owner, bob } = await members();
		await link(bob, "l1", "sub-bob");
		const again = await link(bob, "l2", "sub-other");
		expect(again.headers.location).toBe("https://lumo.test/settings?auth_error=already_linked");
		const taken = await link(owner, "l3", "sub-bob");
		expect(taken.headers.location).toBe("https://lumo.test/settings?auth_error=identity_in_use");
		expect(ctx.db.select().from(users).where(eq(users.username, "alice")).get()?.oidcSubject).toBeNull();
	});

	it("the same subject under another issuer is another identity", async () => {
		const { owner, bob } = await members();
		await link(bob, "l1", "sub-bob");
		ctx.db.update(users).set({ oidcIssuer: "https://old-idp" }).where(eq(users.username, "bob")).run();
		const res = await link(owner, "l2", "sub-bob");
		expect(res.headers.location).toBe("https://lumo.test/settings?linked=1");
	});

	it("mobile: links with the bearer token and the code exchange", async () => {
		const { bob } = await members();
		const tokens = await post("/auth/local/login", { username: "bob", password: PASSWORD, client: "mobile" });
		ctx.oidc.grant("m1", { sub: "sub-bob-mobile" });
		const res = await post(
			"/auth/mobile/link",
			{ code: "m1", codeVerifier: "v".repeat(50), redirectUri: "lumo://auth", nonce: "n-123", state: "s-123" },
			{ authorization: `Bearer ${tokens.json().accessToken}` },
		);
		expect(res.statusCode).toBe(204);
		expect(bobRow()?.oidcSubject).toBe("sub-bob-mobile");
		expect(bob).toBeTruthy();
		const unauth = await post("/auth/mobile/link", {
			code: "m1",
			codeVerifier: "v".repeat(50),
			redirectUri: "lumo://auth",
			nonce: "n",
		});
		expect(unauth.statusCode).toBe(401);
	});
});
