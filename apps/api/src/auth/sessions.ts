// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sessions } from "../db/schema.js";
import { errors } from "../errors.js";
import { writeTx } from "../services/members.js";
import { hashToken, randomToken } from "./tokens.js";

const DAY = 24 * 60 * 60 * 1000;
export const WEB_SESSION_TTL_MS = 30 * DAY;
export const MOBILE_SESSION_TTL_MS = 60 * DAY;

export type SessionKind = "web" | "mobile";

const ttlFor = (kind: SessionKind) => (kind === "web" ? WEB_SESSION_TTL_MS : MOBILE_SESSION_TTL_MS);

/** Crée une session ; renvoie le jeton en clair (cookie web ou refresh token mobile), non stocké. */
export function createSession(db: Db, input: { userId: string; kind: SessionKind; now?: Date }) {
	const now = input.now ?? new Date();
	const token = randomToken();
	const id = randomUUID();
	db.insert(sessions)
		.values({
			id,
			userId: input.userId,
			kind: input.kind,
			refreshTokenHash: hashToken(token),
			expiresAt: new Date(now.getTime() + ttlFor(input.kind)),
			lastUsedAt: now,
		})
		.run();
	return { sessionId: id, token, expiresAt: new Date(now.getTime() + ttlFor(input.kind)) };
}

/** Session web valide correspondant au cookie, ou null. */
export function findWebSession(db: Db, token: string, now = new Date()) {
	const row = db
		.select()
		.from(sessions)
		.where(and(eq(sessions.refreshTokenHash, hashToken(token)), eq(sessions.kind, "web"), gt(sessions.expiresAt, now)))
		.get();
	return row ?? null;
}

/** La session existe-t-elle encore (jeton d'accès non révoqué) ? */
export function isSessionActive(db: Db, sessionId: string, userId: string, now = new Date()): boolean {
	return (
		db
			.select({ id: sessions.id })
			.from(sessions)
			.where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
			.get() !== undefined
	);
}

/**
 * Rotation du refresh token mobile. Un jeton déjà roté qui revient (vol probable) révoque la session.
 */
export function rotateRefreshToken(db: Db, token: string, now = new Date()) {
	const hash = hashToken(token);
	// Le résultat « refusé » sort de la transaction : un `throw` à l'intérieur annulerait la révocation.
	const result = writeTx(db, (tx) => {
		const current = tx.select().from(sessions).where(eq(sessions.refreshTokenHash, hash)).get();
		if (current) {
			if (current.kind !== "mobile" || current.expiresAt <= now) return null;
			const next = randomToken();
			const expiresAt = new Date(now.getTime() + MOBILE_SESSION_TTL_MS);
			tx.update(sessions)
				.set({ refreshTokenHash: hashToken(next), previousTokenHash: hash, expiresAt, lastUsedAt: now })
				.where(eq(sessions.id, current.id))
				.run();
			return { sessionId: current.id, userId: current.userId, token: next };
		}
		const reused = tx.select().from(sessions).where(eq(sessions.previousTokenHash, hash)).get();
		if (reused) tx.delete(sessions).where(eq(sessions.id, reused.id)).run();
		return null;
	});
	if (!result) throw errors.unauthenticated();
	return result;
}

export function deleteSession(db: Db, sessionId: string) {
	db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function purgeExpiredSessions(db: Db, now = new Date()) {
	db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
}
