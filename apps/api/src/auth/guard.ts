// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { errors } from "../errors.js";
import { findWebSession, isSessionActive } from "./sessions.js";
import { verifyAccessToken } from "./tokens.js";

export const SESSION_COOKIE = "lumo_session";

export interface AuthContext {
	userId: string;
	sessionId: string;
	via: "bearer" | "cookie";
}

declare module "fastify" {
	interface FastifyRequest {
		auth: AuthContext | null;
	}
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function authenticate(req: FastifyRequest, db: Db, config: Config): Promise<AuthContext | null> {
	const header = req.headers.authorization;
	if (header?.startsWith("Bearer ")) {
		const claims = await verifyAccessToken(config.SESSION_SECRET, header.slice(7));
		if (claims && isSessionActive(db, claims.sessionId, claims.userId)) {
			return { userId: claims.userId, sessionId: claims.sessionId, via: "bearer" };
		}
		return null;
	}
	const cookie = req.cookies[SESSION_COOKIE];
	if (cookie) {
		const session = findWebSession(db, cookie);
		if (session) return { userId: session.userId, sessionId: session.id, via: "cookie" };
	}
	return null;
}

/**
 * Authentication guard. For a cookie session, any request that changes state must
 * come from the site's origin (CSRF defence on top of `SameSite=Lax`).
 */
export function createRequireAuth(db: Db, config: Config) {
	const origin = new URL(config.PUBLIC_URL).origin;
	return async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
		const auth = await authenticate(req, db, config);
		if (!auth) throw errors.unauthenticated();
		if (auth.via === "cookie" && !SAFE_METHODS.has(req.method) && req.headers.origin !== origin) {
			throw errors.forbidden("Request origin not allowed");
		}
		req.auth = auth;
	};
}
