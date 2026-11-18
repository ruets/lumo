// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { oidcStates, users } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import { userCount, writeTx } from "../services/members.js";
import { type AuthContext, SESSION_COOKIE } from "./guard.js";
import { linkOidcIdentity, registerLocal, resolveOidcLogin, setupInstance } from "./identity.js";
import { type OidcProvider, pkce } from "./oidc.js";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./passwords.js";
import { createSession, deleteSession, findWebSession, rotateRefreshToken, WEB_SESSION_TTL_MS } from "./sessions.js";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "./tokens.js";

const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

const username = z
	.string()
	.trim()
	.toLowerCase()
	.regex(/^[a-z0-9._-]{3,32}$/, "3 to 32 characters: letters, digits, dot, hyphen, underscore");
const password = z.string().min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`).max(200);
const displayName = z.string().trim().min(1).max(80);
const client = z.enum(["web", "mobile"]).default("web");

const schemas = {
	login: z.object({ username, password: z.string().min(1).max(200), client }),
	setup: z.object({ householdName: z.string().trim().min(1).max(80), displayName, username, password, client }),
	register: z.object({ invite: z.string().min(10).max(200), displayName, username, password, client }),
	refresh: z.object({ refreshToken: z.string().min(10).max(200) }),
	mobileExchange: z.object({
		code: z.string().min(1).max(2000),
		codeVerifier: z.string().min(43).max(128),
		redirectUri: z.string().min(1).max(500),
		nonce: z.string().min(1).max(200),
		state: z.string().min(1).max(200).optional(),
		invite: z.string().min(10).max(200).optional(),
	}),
	callbackQuery: z.object({ invite: z.string().min(10).max(200).optional() }),
};

function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
	const result = schema.safeParse(data);
	if (!result.success) {
		throw errors.validation(result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
	}
	return result.data;
}

interface Deps {
	db: Db;
	config: Config;
	oidc: OidcProvider | null;
	requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export function registerAuthRoutes(app: FastifyInstance, { db, config, oidc, requireAuth }: Deps) {
	const limited = (max: number) => ({ config: { rateLimit: { max, timeWindow: "1 minute" } } });

	function setWebCookie(reply: FastifyReply, token: string) {
		reply.setCookie(SESSION_COOKIE, token, {
			httpOnly: true,
			secure: config.secureCookies,
			sameSite: "lax",
			path: "/",
			maxAge: WEB_SESSION_TTL_MS / 1000,
		});
	}

	async function mobileTokens(userId: string, sessionId: string, refreshToken: string) {
		return {
			accessToken: await signAccessToken(config.SESSION_SECRET, { userId, sessionId }),
			refreshToken,
			expiresIn: ACCESS_TOKEN_TTL_SECONDS,
		};
	}

	/** Opens a session: cookie for the web, token pair for mobile. */
	async function startSession(reply: FastifyReply, userId: string, kind: "web" | "mobile") {
		const session = createSession(db, { userId, kind });
		if (kind === "web") {
			setWebCookie(reply, session.token);
			return { ok: true as const };
		}
		return mobileTokens(userId, session.sessionId, session.token);
	}

	function requireLocal() {
		if (!config.LOCAL_AUTH_ENABLED) throw errors.localAuthDisabled();
	}

	function requireOidc(): OidcProvider {
		if (!oidc) throw errors.oidcDisabled();
		return oidc;
	}

	// Public and unauthenticated: the mobile app queries it to check that an address really is a
	// Lumo server (`app`) and to learn how to sign in. The issuer and client_id are not secret.
	app.get("/auth/config", async () => ({
		app: "lumo" as const,
		oidc: config.oidcEnabled,
		oidcName: config.OIDC_PROVIDER_NAME,
		oidcIssuer: config.OIDC_ISSUER ?? null,
		oidcClientId: config.OIDC_CLIENT_ID ?? null,
		local: config.LOCAL_AUTH_ENABLED,
		setupRequired: config.LOCAL_AUTH_ENABLED && userCount(db) === 0,
	}));

	// ---- OIDC web (BFF) -------------------------------------------------------------------
	const callbackUri = `${config.PUBLIC_URL.replace(/\/$/, "")}/api/v1/auth/callback`;

	app.get("/auth/login", limited(30), async (req, reply) => {
		const provider = requireOidc();
		const { invite } = parse(schemas.callbackQuery, req.query);
		const state = pkce.state();
		const nonce = pkce.nonce();
		const codeVerifier = pkce.codeVerifier();
		db.insert(oidcStates)
			.values({
				state,
				nonce,
				codeVerifier,
				inviteToken: invite ?? null,
				expiresAt: new Date(Date.now() + OIDC_STATE_TTL_MS),
			})
			.run();
		const url = await provider.buildAuthorizationUrl({
			redirectUri: callbackUri,
			state,
			nonce,
			codeChallenge: await pkce.codeChallenge(codeVerifier),
		});
		return reply.redirect(url);
	});

	// A signed-in account starts linking an Authentik identity to itself.
	app.get("/auth/link", { ...limited(30), preHandler: requireAuth }, async (req, reply) => {
		const provider = requireOidc();
		const { userId } = req.auth as AuthContext;
		const state = pkce.state();
		const nonce = pkce.nonce();
		const codeVerifier = pkce.codeVerifier();
		db.insert(oidcStates)
			.values({
				state,
				nonce,
				codeVerifier,
				linkUserId: userId,
				expiresAt: new Date(Date.now() + OIDC_STATE_TTL_MS),
			})
			.run();
		const url = await provider.buildAuthorizationUrl({
			redirectUri: callbackUri,
			state,
			nonce,
			codeChallenge: await pkce.codeChallenge(codeVerifier),
		});
		return reply.redirect(url);
	});

	app.get("/auth/callback", limited(30), async (req, reply) => {
		const provider = requireOidc();
		const fail = (code: string) => reply.redirect(`${config.PUBLIC_URL.replace(/\/$/, "")}/?auth_error=${code}`);
		const callbackUrl = new URL(req.url, config.PUBLIC_URL);
		const state = callbackUrl.searchParams.get("state");
		if (!state) return fail("oidc_failed");

		// The state is single-use: it is consumed before any exchange.
		const saved = writeTx(db, (tx) => {
			const row = tx.select().from(oidcStates).where(eq(oidcStates.state, state)).get();
			if (row) tx.delete(oidcStates).where(eq(oidcStates.state, state)).run();
			return row;
		});
		if (!saved || saved.expiresAt.getTime() < Date.now()) return fail("oidc_failed");

		try {
			const claims = await provider.exchange({
				callbackUrl: new URL(`${callbackUri}${callbackUrl.search}`),
				codeVerifier: saved.codeVerifier,
				expectedState: state,
				expectedNonce: saved.nonce,
			});
			if (saved.linkUserId) {
				// The browser finishing the flow must be the one that started it: otherwise someone could get a victim
				// to complete their own link request and attach the victim's Authentik identity to the attacker's account.
				const cookie = req.cookies[SESSION_COOKIE];
				const session = cookie ? findWebSession(db, cookie) : null;
				if (session?.userId !== saved.linkUserId) throw errors.forbidden("Not the browser that started the link");
				linkOidcIdentity(db, config, saved.linkUserId, claims);
				return reply.redirect(`${config.PUBLIC_URL.replace(/\/$/, "")}/settings?linked=1`);
			}
			const { userId } = resolveOidcLogin(db, config, claims, saved.inviteToken);
			setWebCookie(reply, createSession(db, { userId, kind: "web" }).token);
			return reply.redirect(`${config.PUBLIC_URL.replace(/\/$/, "")}/`);
		} catch (err) {
			const target = saved.linkUserId ? "/settings" : "/";
			const to = (code: string) =>
				reply.redirect(`${config.PUBLIC_URL.replace(/\/$/, "")}${target}?auth_error=${code}`);
			if (err instanceof AppError) return to(err.code);
			req.log.warn({ err }, "OIDC exchange failed");
			return to("oidc_failed");
		}
	});

	// ---- OIDC mobile ----------------------------------------------------------------------
	app.post("/auth/mobile/exchange", limited(20), async (req, reply) => {
		const provider = requireOidc();
		const body = parse(schemas.mobileExchange, req.body);
		const callbackUrl = new URL(body.redirectUri);
		callbackUrl.searchParams.set("code", body.code);
		if (body.state) callbackUrl.searchParams.set("state", body.state);
		let claims: Awaited<ReturnType<OidcProvider["exchange"]>>;
		try {
			claims = await provider.exchange({
				callbackUrl,
				codeVerifier: body.codeVerifier,
				expectedState: body.state ?? null,
				expectedNonce: body.nonce,
			});
		} catch (err) {
			req.log.warn({ err }, "OIDC mobile exchange failed");
			throw errors.oidcFailed();
		}
		const { userId } = resolveOidcLogin(db, config, claims, body.invite ?? null);
		return reply.send(await startSession(reply, userId, "mobile"));
	});

	// Mobile: a signed-in account links an Authentik identity to itself.
	app.post("/auth/mobile/link", { ...limited(20), preHandler: requireAuth }, async (req, reply) => {
		const provider = requireOidc();
		const { userId } = req.auth as AuthContext;
		const body = parse(schemas.mobileExchange, req.body);
		const callbackUrl = new URL(body.redirectUri);
		callbackUrl.searchParams.set("code", body.code);
		if (body.state) callbackUrl.searchParams.set("state", body.state);
		let claims: Awaited<ReturnType<OidcProvider["exchange"]>>;
		try {
			claims = await provider.exchange({
				callbackUrl,
				codeVerifier: body.codeVerifier,
				expectedState: body.state ?? null,
				expectedNonce: body.nonce,
			});
		} catch (err) {
			req.log.warn({ err }, "OIDC mobile link failed");
			throw errors.oidcFailed();
		}
		linkOidcIdentity(db, config, userId, claims);
		return reply.code(204).send();
	});

	app.post("/auth/refresh", limited(60), async (req) => {
		const { refreshToken } = parse(schemas.refresh, req.body);
		const rotated = rotateRefreshToken(db, refreshToken);
		return mobileTokens(rotated.userId, rotated.sessionId, rotated.token);
	});

	// ---- Comptes locaux -------------------------------------------------------------------
	app.post("/auth/local/login", limited(10), async (req, reply) => {
		requireLocal();
		const body = parse(schemas.login, req.body);
		const user = db.select().from(users).where(eq(users.username, body.username)).get();
		const ok = await verifyPassword(user?.passwordHash ?? null, body.password);
		if (!user || !ok) throw errors.invalidCredentials();
		if (user.disabledAt || user.deletedAt) throw errors.accountDisabled();
		return reply.send(await startSession(reply, user.id, body.client));
	});

	app.post("/auth/setup", limited(10), async (req, reply) => {
		requireLocal();
		const body = parse(schemas.setup, req.body);
		if (userCount(db) > 0) throw errors.setupDone();
		const passwordHash = await hashPassword(body.password);
		const { userId } = setupInstance(db, { ...body, passwordHash });
		return reply.code(201).send(await startSession(reply, userId, body.client));
	});

	app.post("/auth/local/register", limited(10), async (req, reply) => {
		requireLocal();
		const body = parse(schemas.register, req.body);
		const passwordHash = await hashPassword(body.password);
		const { userId } = registerLocal(db, {
			inviteToken: body.invite,
			username: body.username,
			displayName: body.displayName,
			passwordHash,
		});
		return reply.code(201).send(await startSession(reply, userId, body.client));
	});

	// ---- Sign-out ----------------------------------------------------------------------
	app.post("/auth/logout", { preHandler: requireAuth }, async (req, reply) => {
		const auth = req.auth as AuthContext;
		deleteSession(db, auth.sessionId);
		reply.clearCookie(SESSION_COOKIE, { path: "/" });
		return reply.code(204).send();
	});
}
