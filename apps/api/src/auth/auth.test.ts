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

describe("instance neuve", () => {
	it("annonce qu'un setup est nécessaire, puis plus", async () => {
		expect((await get("/auth/config")).json()).toEqual({ oidc: true, local: true, setupRequired: true });
		await setupOwner(ctx);
		expect((await get("/auth/config")).json().setupRequired).toBe(false);
	});

	it("crée le foyer, l'owner, son porte-monnaie et la cagnotte", async () => {
		const cookie = await setupOwner(ctx);
		const me = (await get("/me", cookieHeader(cookie))).json();
		expect(me.user.displayName).toBe("Alice");
		expect(me.household.name).toBe("Les Dupont");
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

	it("rejette un mot de passe trop court", async () => {
		const res = await post("/auth/setup", { ...OWNER, password: "court" });
		expect(res.statusCode).toBe(400);
		expect(res.headers["content-type"]).toContain("application/problem+json");
		expect(res.json().code).toBe("validation_error");
	});

	it("ne stocke jamais le mot de passe en clair", async () => {
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

	it("refuse un mauvais mot de passe et un identifiant inconnu avec la même erreur", async () => {
		const bad = await post("/auth/local/login", { username: "alice", password: "mauvais-mot-de-passe" });
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

	it("mobile : renvoie jeton d'accès et refresh, utilisables en Bearer", async () => {
		const res = await post("/auth/local/login", { username: "alice", password: OWNER.password, client: "mobile" });
		const tokens = res.json();
		expect(tokens.expiresIn).toBe(900);
		const me = await get("/me", { authorization: `Bearer ${tokens.accessToken}` });
		expect(me.statusCode).toBe(200);
		expect(me.json().user.displayName).toBe("Alice");
	});

	it("bloque la force brute (429 au-delà de 10 essais par minute)", async () => {
		let last = 0;
		for (let i = 0; i < 12; i++) {
			last = (await post("/auth/local/login", { username: "alice", password: "faux-faux-faux" })).statusCode;
		}
		expect(last).toBe(429);
	});
});

describe("comptes locaux désactivés", () => {
	it("répond 404 sur les routes locales", async () => {
		await ctx.close();
		ctx = await createTestContext({ LOCAL_AUTH_ENABLED: "false" });
		const res = await post("/auth/local/login", { username: "alice", password: OWNER.password });
		expect(res.statusCode).toBe(404);
		expect(res.json().code).toBe("local_auth_disabled");
		expect((await get("/auth/config")).json()).toMatchObject({ local: false, setupRequired: false });
	});
});

describe("sessions et accès protégés", () => {
	it("refuse /me sans authentification, ou avec un jeton bidon", async () => {
		expect((await get("/me")).statusCode).toBe(401);
		expect((await get("/me", { authorization: "Bearer n-importe-quoi" })).statusCode).toBe(401);
		expect((await get("/me", cookieHeader("inconnu"))).statusCode).toBe(401);
	});

	it("refuse un jeton signé avec un autre secret", async () => {
		const { signAccessToken } = await import("./tokens.js");
		const forged = await signAccessToken("y".repeat(40), { userId: await ownerIdAfterSetup(), sessionId: "s" });
		expect((await get("/me", { authorization: `Bearer ${forged}` })).statusCode).toBe(401);
	});

	async function ownerIdAfterSetup() {
		await setupOwner(ctx);
		return ownerId();
	}

	it("déconnexion : exige l'origine du site avec un cookie (CSRF), puis révoque la session", async () => {
		const cookie = await setupOwner(ctx);
		const noOrigin = await post("/auth/logout", {}, cookieHeader(cookie));
		expect(noOrigin.statusCode).toBe(403);
		const evil = await post("/auth/logout", {}, { ...cookieHeader(cookie), origin: "https://evil.test" });
		expect(evil.statusCode).toBe(403);

		const ok = await post("/auth/logout", {}, { ...cookieHeader(cookie), ...ORIGIN });
		expect(ok.statusCode).toBe(204);
		expect((await get("/me", cookieHeader(cookie))).statusCode).toBe(401);
	});

	it("déconnexion mobile : le jeton d'accès cesse de fonctionner", async () => {
		await setupOwner(ctx);
		const tokens = (
			await post("/auth/local/login", { username: "alice", password: OWNER.password, client: "mobile" })
		).json();
		const auth = { authorization: `Bearer ${tokens.accessToken}` };
		expect((await post("/auth/logout", {}, auth)).statusCode).toBe(204);
		expect((await get("/me", auth)).statusCode).toBe(401);
	});

	it("session expirée : refusée", async () => {
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

	it("émet de nouveaux jetons et invalide l'ancien refresh", async () => {
		const first = await mobileLogin();
		const res = await post("/auth/refresh", { refreshToken: first.refreshToken });
		expect(res.statusCode).toBe(200);
		const second = res.json();
		expect(second.refreshToken).not.toBe(first.refreshToken);
		expect((await get("/me", { authorization: `Bearer ${second.accessToken}` })).statusCode).toBe(200);
		expect((await post("/auth/refresh", { refreshToken: second.refreshToken })).statusCode).toBe(200);
	});

	it("révoque toute la session si un ancien refresh est rejoué", async () => {
		const first = await mobileLogin();
		const second = (await post("/auth/refresh", { refreshToken: first.refreshToken })).json();
		// Rejeu du jeton déjà utilisé (vol probable) : refusé, et la session entière est révoquée.
		expect((await post("/auth/refresh", { refreshToken: first.refreshToken })).statusCode).toBe(401);
		expect((await post("/auth/refresh", { refreshToken: second.refreshToken })).statusCode).toBe(401);
		expect((await get("/me", { authorization: `Bearer ${second.accessToken}` })).statusCode).toBe(401);
	});

	it("refuse un cookie web utilisé comme refresh token", async () => {
		const cookie = await setupOwner(ctx);
		expect((await post("/auth/refresh", { refreshToken: cookie })).statusCode).toBe(401);
	});

	it("ne stocke que des hashs", async () => {
		const first = await mobileLogin();
		const rows = ctx.db.select().from(sessions).all();
		expect(JSON.stringify(rows)).not.toContain(first.refreshToken);
	});
});

describe("invitations et comptes locaux", () => {
	async function invite(role: "adult" | "child", cookie: string) {
		const res = await post("/household/invites", { role }, { ...cookieHeader(cookie), ...ORIGIN });
		expect(res.statusCode).toBe(201);
		return res.json().token as string;
	}

	it("refuse la création de compte sans invitation valide", async () => {
		await setupOwner(ctx);
		const res = await post("/auth/local/register", {
			invite: "jeton-inexistant-123",
			displayName: "Bob",
			username: "bob",
			password: "un-mot-de-passe-long",
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("invalid_invite");
	});

	it("crée un membre avec le rôle de l'invitation, son porte-monnaie, et brûle l'invitation", async () => {
		const owner = await setupOwner(ctx);
		const token = await invite("child", owner);
		const res = await post("/auth/local/register", {
			invite: token,
			displayName: "Bob",
			username: "bob",
			password: "un-mot-de-passe-long",
		});
		expect(res.statusCode).toBe(201);
		const me = (await get("/me", cookieHeader(sessionCookie(res) as string))).json();
		expect(me.role).toBe("child");
		expect(me.household.name).toBe("Les Dupont");
		expect(me.wallets.personal.id).toBeTruthy();

		const again = await post("/auth/local/register", {
			invite: token,
			displayName: "Eve",
			username: "eve",
			password: "un-mot-de-passe-long",
		});
		expect(again.json().code).toBe("invalid_invite");
	});

	it("refuse une invitation expirée", async () => {
		await setupOwner(ctx);
		const household = ctx.db.select().from(memberships).get();
		const { token } = createInvite(ctx.db, {
			householdId: household?.householdId as string,
			role: "adult",
			createdBy: await ownerId(),
			now: new Date(Date.now() - 8 * 24 * 3600 * 1000),
		});
		const res = await post("/auth/local/register", {
			invite: token,
			displayName: "Bob",
			username: "bob",
			password: "un-mot-de-passe-long",
		});
		expect(res.json().code).toBe("invalid_invite");
	});

	it("refuse un identifiant déjà pris, sans consommer l'invitation", async () => {
		const owner = await setupOwner(ctx);
		const token = await invite("adult", owner);
		const clash = await post("/auth/local/register", {
			invite: token,
			displayName: "Autre",
			username: "alice",
			password: "un-mot-de-passe-long",
		});
		expect(clash.statusCode).toBe(409);
		const ok = await post("/auth/local/register", {
			invite: token,
			displayName: "Bob",
			username: "bob",
			password: "un-mot-de-passe-long",
		});
		expect(ok.statusCode).toBe(201);
	});

	it("seul un owner peut inviter", async () => {
		const owner = await setupOwner(ctx);
		const token = await invite("adult", owner);
		const adult = await post("/auth/local/register", {
			invite: token,
			displayName: "Bob",
			username: "bob",
			password: "un-mot-de-passe-long",
		});
		const res = await post(
			"/household/invites",
			{ role: "child" },
			{ ...cookieHeader(sessionCookie(adult) as string), ...ORIGIN },
		);
		expect(res.statusCode).toBe(403);
		expect(
			(await post("/household/invites", { role: "owner" }, { ...cookieHeader(owner), ...ORIGIN })).statusCode,
		).toBe(400);
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

	it("redirige vers Authentik avec state, nonce et PKCE S256", async () => {
		const { url } = await startLogin();
		expect(url.origin).toBe("https://idp.test");
		expect(url.searchParams.get("redirect_uri")).toBe("https://lumo.test/api/v1/auth/callback");
		expect(url.searchParams.get("state")).toBeTruthy();
		expect(url.searchParams.get("nonce")).toBeTruthy();
		expect(url.searchParams.get("code_challenge")).toBeTruthy();
	});

	it("premier utilisateur de l'instance : devient owner d'un nouveau foyer", async () => {
		ctx.oidc.grant("c1", { sub: "sub-1", name: "Alice Authentik" });
		const { state } = await startLogin();
		const res = await callback(state, "c1");
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe("https://lumo.test/");
		const me = (await get("/me", cookieHeader(sessionCookie(res) as string))).json();
		expect(me).toMatchObject({ role: "owner", user: { displayName: "Alice Authentik" } });
	});

	it("reconnaît un utilisateur connu par son sub, sans doublon", async () => {
		ctx.oidc.grant("c1", { sub: "sub-1" });
		ctx.oidc.grant("c2", { sub: "sub-1" });
		await callback((await startLogin()).state, "c1");
		await callback((await startLogin()).state, "c2");
		expect(ctx.db.select().from(users).all()).toHaveLength(1);
	});

	it("refuse un inconnu sans invitation une fois l'instance initialisée", async () => {
		await setupOwner(ctx);
		ctx.oidc.grant("c1", { sub: "intrus" });
		const res = await callback((await startLogin()).state, "c1");
		expect(res.headers.location).toBe("https://lumo.test/?auth_error=invitation_required");
		expect(sessionCookie(res)).toBeNull();
		expect(ctx.db.select().from(users).all()).toHaveLength(1);
	});

	it("crée le compte d'un invité et lie son sub", async () => {
		const owner = await setupOwner(ctx);
		const token = (await post("/household/invites", { role: "adult" }, { ...cookieHeader(owner), ...ORIGIN })).json()
			.token;
		ctx.oidc.grant("c1", { sub: "sub-bob", name: "Bob" });
		const res = await callback((await startLogin(token)).state, "c1");
		const me = (await get("/me", cookieHeader(sessionCookie(res) as string))).json();
		expect(me).toMatchObject({ role: "adult", household: { name: "Les Dupont" } });
		// Le sub est maintenant lié : la même invitation ne sert plus, mais Bob se reconnecte sans.
		ctx.oidc.grant("c2", { sub: "sub-bob" });
		const again = await callback((await startLogin()).state, "c2");
		expect(sessionCookie(again)).toBeTruthy();
	});

	it("groupe lumo-admins : promeut en owner, sans jamais rétrograder", async () => {
		const owner = await setupOwner(ctx);
		const token = (await post("/household/invites", { role: "adult" }, { ...cookieHeader(owner), ...ORIGIN })).json()
			.token;
		ctx.oidc.grant("c1", { sub: "sub-bob" });
		await callback((await startLogin(token)).state, "c1");
		const role = () => ctx.db.select().from(memberships).where(eq(memberships.role, "owner")).all().length;
		expect(role()).toBe(1);

		ctx.oidc.grant("c2", { sub: "sub-bob", groups: ["lumo-admins"] });
		await callback((await startLogin()).state, "c2");
		expect(role()).toBe(2);

		ctx.oidc.grant("c3", { sub: "sub-bob", groups: [] });
		await callback((await startLogin()).state, "c3");
		expect(role()).toBe(2);
	});

	it("le state est à usage unique et obligatoire", async () => {
		ctx.oidc.grant("c1", { sub: "sub-1" });
		const { state } = await startLogin();
		expect((await callback(state, "c1")).headers.location).toBe("https://lumo.test/");
		expect((await callback(state, "c1")).headers.location).toBe("https://lumo.test/?auth_error=oidc_failed");
		expect((await callback("state-inconnu", "c1")).headers.location).toBe("https://lumo.test/?auth_error=oidc_failed");
		expect((await get("/auth/callback?code=c1")).headers.location).toBe("https://lumo.test/?auth_error=oidc_failed");
	});

	it("un code invalide échoue proprement, sans session", async () => {
		const { state } = await startLogin();
		const res = await callback(state, "code-inconnu");
		expect(res.headers.location).toBe("https://lumo.test/?auth_error=oidc_failed");
		expect(sessionCookie(res)).toBeNull();
	});

	it("est indisponible si OIDC n'est pas configuré", async () => {
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

	it("échange le code contre une paire de jetons, en transmettant PKCE et nonce", async () => {
		ctx.oidc.grant("m1", { sub: "sub-m", name: "Mobile" });
		const res = await post("/auth/mobile/exchange", body());
		expect(res.statusCode).toBe(200);
		expect(ctx.oidc.lastExchange).toMatchObject({ codeVerifier: "v".repeat(50), expectedNonce: "n-123" });
		const { accessToken } = res.json();
		expect((await get("/me", { authorization: `Bearer ${accessToken}` })).json().role).toBe("owner");
	});

	it("refuse un inconnu sans invitation", async () => {
		await setupOwner(ctx);
		ctx.oidc.grant("m1", { sub: "intrus" });
		const res = await post("/auth/mobile/exchange", body());
		expect(res.statusCode).toBe(403);
		expect(res.json().code).toBe("invitation_required");
	});

	it("accepte une invitation", async () => {
		const owner = await setupOwner(ctx);
		const token = (await post("/household/invites", { role: "child" }, { ...cookieHeader(owner), ...ORIGIN })).json()
			.token;
		ctx.oidc.grant("m1", { sub: "sub-kid" });
		const res = await post("/auth/mobile/exchange", body({ invite: token }));
		expect((await get("/me", { authorization: `Bearer ${res.json().accessToken}` })).json().role).toBe("child");
	});

	it("renvoie oidc_failed si Authentik refuse le code", async () => {
		const res = await post("/auth/mobile/exchange", body({ code: "faux" }));
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("oidc_failed");
	});
});

describe("divers", () => {
	it("expose /healthz et /readyz", async () => {
		expect((await ctx.app.inject({ url: "/healthz" })).json()).toEqual({ status: "ok" });
		expect((await ctx.app.inject({ url: "/readyz" })).statusCode).toBe(200);
	});

	it("renvoie les 404 en problem+json", async () => {
		const res = await get("/inexistant");
		expect(res.statusCode).toBe(404);
		expect(res.headers["content-type"]).toContain("application/problem+json");
	});
});
