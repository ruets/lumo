// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { accountInvites, guardianshipCodes, invites } from "../db/schema.js";
import { errors } from "../errors.js";
import { createAccount, joinHousehold, type NewUser, type Tx } from "../services/members.js";
import { startSupervision } from "../services/supervision.js";
import { hashToken, randomToken } from "./tokens.js";

export const ACCOUNT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What a sign-up code was made for. One code field serves them all. */
export type SignupToken =
	| { type: "household"; invite: typeof invites.$inferSelect }
	| { type: "supervise"; code: typeof guardianshipCodes.$inferSelect }
	| { type: "account"; invite: typeof accountInvites.$inferSelect };

/** A super admin invites someone to create an account (no household, no supervision). */
export function createAccountInvite(tx: Tx, createdBy: string, now: Date) {
	const token = randomToken();
	const expiresAt = new Date(now.getTime() + ACCOUNT_INVITE_TTL_MS);
	tx.insert(accountInvites)
		.values({ id: randomUUID(), tokenHash: hashToken(token), createdBy, expiresAt, createdAt: now })
		.run();
	return { token, expiresAt: expiresAt.toISOString() };
}

/** The valid code behind a token, or `null`: a household invitation, a guardian's code, or an account invitation. */
export function findSignupToken(tx: Tx, token: string, now: Date): SignupToken | null {
	const hash = hashToken(token);
	const household = tx
		.select()
		.from(invites)
		.where(and(eq(invites.tokenHash, hash), isNull(invites.usedAt), gt(invites.expiresAt, now)))
		.get();
	if (household) return { type: "household", invite: household };
	const supervise = tx
		.select()
		.from(guardianshipCodes)
		.where(
			and(
				eq(guardianshipCodes.tokenHash, hash),
				eq(guardianshipCodes.kind, "supervise"),
				isNull(guardianshipCodes.usedAt),
				gt(guardianshipCodes.expiresAt, now),
			),
		)
		.get();
	if (supervise) return { type: "supervise", code: supervise };
	const account = tx
		.select()
		.from(accountInvites)
		.where(and(eq(accountInvites.tokenHash, hash), isNull(accountInvites.usedAt), gt(accountInvites.expiresAt, now)))
		.get();
	return account ? { type: "account", invite: account } : null;
}

export function resolveSignupToken(tx: Tx, token: string, now: Date): SignupToken {
	const found = findSignupToken(tx, token, now);
	if (!found) throw errors.invalidInvite();
	return found;
}

/**
 * Creates the account of a person who came with a code, and applies what the code was for: join the household,
 * become the ward of the guardian who made it, or simply exist. Local or OIDC: the caller supplies the identity.
 */
export function createAccountFromSignup(tx: Tx, signup: SignupToken, user: NewUser, now: Date): string {
	const userId = createAccount(tx, user);
	if (signup.type === "household") {
		joinHousehold(tx, { householdId: signup.invite.householdId, userId, role: signup.invite.role });
		tx.update(invites).set({ usedAt: now, usedBy: userId }).where(eq(invites.id, signup.invite.id)).run();
	} else if (signup.type === "supervise") {
		startSupervision(tx, signup.code.createdBy, userId);
		tx.update(guardianshipCodes)
			.set({ usedAt: now, usedBy: userId })
			.where(eq(guardianshipCodes.id, signup.code.id))
			.run();
	} else {
		tx.update(accountInvites).set({ usedAt: now, usedBy: userId }).where(eq(accountInvites.id, signup.invite.id)).run();
	}
	return userId;
}
