// SPDX-License-Identifier: AGPL-3.0-or-later
import { isSuperAdminAfterOidcLogin } from "@lumo/domain";
import { and, eq } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { memberships, users } from "../db/schema.js";
import { errors } from "../errors.js";
import {
	createAccount,
	createHousehold,
	createMember,
	joinHousehold,
	type Tx,
	userCount,
	usernameTaken,
	writeTx,
} from "../services/members.js";
import { markInviteUsed } from "./invites.js";
import type { OidcClaims } from "./oidc.js";
import { createAccountFromSignup, joinSupervision, resolveSignupToken } from "./signup.js";

const emailIsFree = (tx: Tx, email: string | null | undefined): boolean =>
	!email || !tx.select({ id: users.id }).from(users).where(eq(users.email, email)).get();

const adminGroup = (config: Config) => config.OIDC_ADMIN_GROUP ?? null;

/**
 * Links an OIDC identity to a Lumo user.
 *  1. Known identity (issuer + `sub`) → sign-in (super admin if in the admin group; a disabled account is refused).
 *  2. A code provided (household invitation, guardian's code, administrator's invitation) → account created and
 *     set up as the code says.
 *  3. No user in the instance → first account: super admin, with a new household.
 *  4. `OIDC_AUTO_CREATE_USERS` → an account without household or supervision.
 *  5. Otherwise → refused: no account without a code.
 */
export function resolveOidcLogin(
	db: Db,
	config: Config,
	claims: OidcClaims,
	inviteToken: string | null,
	now: Date = new Date(),
): { userId: string } {
	return writeTx(db, (tx) => {
		const displayName = claims.name?.trim() || claims.email || "Member";

		const issuer = config.OIDC_ISSUER ?? "";
		const existing = tx
			.select()
			.from(users)
			.where(and(eq(users.oidcIssuer, issuer), eq(users.oidcSubject, claims.sub)))
			.get();
		if (existing) {
			if (existing.deletedAt) throw errors.invitationRequired();
			if (existing.disabledAt) throw errors.accountDisabled();
			const isSuperAdmin = isSuperAdminAfterOidcLogin(existing.isSuperAdmin, claims.groups, adminGroup(config));
			const set: Partial<typeof users.$inferInsert> = {};
			if (isSuperAdmin !== existing.isSuperAdmin) set.isSuperAdmin = isSuperAdmin;
			if (claims.picture && claims.picture !== existing.avatarUrl) set.avatarUrl = claims.picture;
			if (Object.keys(set).length > 0) tx.update(users).set(set).where(eq(users.id, existing.id)).run();
			// A code given to a known identity is applied where it makes sense, and never silently dropped.
			const signup = inviteToken ? resolveSignupToken(tx, inviteToken, now) : null;
			if (signup?.type === "household") {
				if (!tx.select().from(memberships).where(eq(memberships.userId, existing.id)).get()) {
					joinHousehold(tx, { householdId: signup.invite.householdId, userId: existing.id, role: signup.invite.role });
					markInviteUsed(tx, signup.invite.id, existing.id, now);
				}
			} else if (signup?.type === "supervise") {
				// Following a guardian's link while signing in is the consent to be supervised.
				joinSupervision(tx, signup.code, existing.id, now);
			} else if (signup) {
				throw errors.conflict("account_exists", "This identity already has an account");
			}
			return { userId: existing.id };
		}

		const newUser = {
			isSuperAdmin: isSuperAdminAfterOidcLogin(false, claims.groups, adminGroup(config)),
			displayName,
			avatarUrl: claims.picture,
			oidcSubject: claims.sub,
			oidcIssuer: issuer,
			// The e-mail is only informative and unique: never take one another account already holds.
			email: emailIsFree(tx, claims.email) ? claims.email : null,
		};

		if (inviteToken) {
			const signup = resolveSignupToken(tx, inviteToken, now);
			return { userId: createAccountFromSignup(tx, signup, newUser, now) };
		}

		if (userCount(tx) === 0) {
			const householdId = createHousehold(tx, { name: "My household" });
			return { userId: createMember(tx, { householdId, role: "owner", user: { ...newUser, isSuperAdmin: true } }) };
		}

		if (config.OIDC_AUTO_CREATE_USERS) return { userId: createAccount(tx, newUser) };

		throw errors.invitationRequired();
	});
}

/**
 * A signed-in account takes an OIDC identity (a "Link Authentik" button): from then on that identity signs in to
 * this very account. Refused if the account already has an identity or if the identity belongs to someone else.
 */
export function linkOidcIdentity(db: Db, config: Config, userId: string, claims: OidcClaims): void {
	writeTx(db, (tx) => {
		const issuer = config.OIDC_ISSUER ?? "";
		const user = tx.select().from(users).where(eq(users.id, userId)).get();
		if (!user || user.deletedAt || user.disabledAt) throw errors.unauthenticated();
		if (user.oidcSubject) throw errors.alreadyLinked();
		const owner = tx
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.oidcIssuer, issuer), eq(users.oidcSubject, claims.sub)))
			.get();
		if (owner) throw errors.identityInUse();
		const set: Partial<typeof users.$inferInsert> = {
			oidcIssuer: issuer,
			oidcSubject: claims.sub,
			isSuperAdmin: isSuperAdminAfterOidcLogin(user.isSuperAdmin, claims.groups, adminGroup(config)),
		};
		if (claims.picture && !user.avatarUrl) set.avatarUrl = claims.picture;
		// The e-mail is only informative and unique: never take one another account already holds.
		if (claims.email && !user.email && emailIsFree(tx, claims.email)) set.email = claims.email;
		tx.update(users).set(set).where(eq(users.id, userId)).run();
	});
}

export interface LocalAccountInput {
	username: string;
	displayName: string;
	passwordHash: string;
}

/** First account of the instance (local account): the super admin, who also creates the household and owns it. */
export function setupInstance(db: Db, input: LocalAccountInput & { householdName: string }): { userId: string } {
	return writeTx(db, (tx) => {
		if (userCount(tx) > 0) throw errors.setupDone();
		const householdId = createHousehold(tx, { name: input.householdName });
		const userId = createMember(tx, {
			householdId,
			role: "owner",
			user: {
				displayName: input.displayName,
				username: input.username,
				passwordHash: input.passwordHash,
				isSuperAdmin: true,
			},
		});
		return { userId };
	});
}

/** Creation of a local account from a code: a household invitation, a guardian's code or an account invitation. */
export function registerLocal(
	db: Db,
	input: LocalAccountInput & { inviteToken: string },
	now: Date = new Date(),
): { userId: string } {
	return writeTx(db, (tx) => {
		const signup = resolveSignupToken(tx, input.inviteToken, now);
		if (usernameTaken(tx, input.username)) throw errors.conflict("username_taken", "This username is already taken");
		const userId = createAccountFromSignup(
			tx,
			signup,
			{ displayName: input.displayName, username: input.username, passwordHash: input.passwordHash },
			now,
		);
		return { userId };
	});
}
