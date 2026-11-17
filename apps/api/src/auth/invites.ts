// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import type { Role } from "@lumo/domain";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { invites } from "../db/schema.js";
import { errors } from "../errors.js";
import type { Tx } from "../services/members.js";
import { hashToken, randomToken } from "./tokens.js";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createInvite(
	db: Db,
	input: { householdId: string; role: Role; createdBy: string; now?: Date },
): { token: string; expiresAt: Date } {
	const now = input.now ?? new Date();
	const token = randomToken();
	const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
	db.insert(invites)
		.values({
			id: randomUUID(),
			householdId: input.householdId,
			tokenHash: hashToken(token),
			role: input.role,
			createdBy: input.createdBy,
			expiresAt,
		})
		.run();
	return { token, expiresAt };
}

/** Valid invitation (unused, not expired) for this token, or an `invalid_invite` error. */
export function findValidInvite(tx: Tx, token: string, now = new Date()) {
	const row = tx
		.select()
		.from(invites)
		.where(and(eq(invites.tokenHash, hashToken(token)), isNull(invites.usedAt), gt(invites.expiresAt, now)))
		.get();
	if (!row) throw errors.invalidInvite();
	return row;
}

export function markInviteUsed(tx: Tx, inviteId: string, userId: string, now = new Date()) {
	tx.update(invites).set({ usedAt: now, usedBy: userId }).where(eq(invites.id, inviteId)).run();
}
