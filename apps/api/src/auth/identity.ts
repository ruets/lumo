// SPDX-License-Identifier: AGPL-3.0-or-later
import { isSuperAdminAfterOidcLogin, type Role } from "@lumo/domain";
import { and, eq } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { memberships, users } from "../db/schema.js";
import { errors } from "../errors.js";
import {
	createHousehold,
	createMember,
	joinHousehold,
	userCount,
	usernameTaken,
	writeTx,
} from "../services/members.js";
import { findValidInvite, markInviteUsed } from "./invites.js";
import type { OidcClaims } from "./oidc.js";

const adminGroup = (config: Config) => config.OIDC_ADMIN_GROUP ?? null;

/**
 * Links an OIDC identity to a Lumo user.
 *  1. Known identity (issuer + `sub`) → sign-in (super admin if in the admin group; a disabled account is refused).
 *  2. Invitation provided → account created and put in the invitation's household with its role.
 *  3. No user in the instance → first account: super admin, with a new household.
 *  4. Otherwise → refused: no account without an invitation.
 */
export function resolveOidcLogin(
	db: Db,
	config: Config,
	claims: OidcClaims,
	inviteToken: string | null,
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
			// An account without a household that follows an invitation link joins that household.
			if (inviteToken && !tx.select().from(memberships).where(eq(memberships.userId, existing.id)).get()) {
				const invite = findValidInvite(tx, inviteToken);
				joinHousehold(tx, { householdId: invite.householdId, userId: existing.id, role: invite.role });
				markInviteUsed(tx, invite.id, existing.id);
			}
			return { userId: existing.id };
		}

		const newUser = {
			isSuperAdmin: isSuperAdminAfterOidcLogin(false, claims.groups, adminGroup(config)),
			displayName,
			avatarUrl: claims.picture,
			oidcSubject: claims.sub,
			oidcIssuer: issuer,
			email: claims.email,
		};

		if (inviteToken) {
			const invite = findValidInvite(tx, inviteToken);
			const userId = createMember(tx, { householdId: invite.householdId, role: invite.role, user: newUser });
			markInviteUsed(tx, invite.id, userId);
			return { userId };
		}

		if (userCount(tx) === 0) {
			const householdId = createHousehold(tx, { name: "My household" });
			return { userId: createMember(tx, { householdId, role: "owner", user: { ...newUser, isSuperAdmin: true } }) };
		}

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
		if (
			claims.email &&
			!user.email &&
			!tx.select({ id: users.id }).from(users).where(eq(users.email, claims.email)).get()
		) {
			set.email = claims.email;
		}
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

/** Creation of a local account from an invitation. */
export function registerLocal(db: Db, input: LocalAccountInput & { inviteToken: string }): { userId: string } {
	return writeTx(db, (tx) => {
		const invite = findValidInvite(tx, input.inviteToken);
		if (usernameTaken(tx, input.username)) throw errors.conflict("username_taken", "This username is already taken");
		const userId = createMember(tx, {
			householdId: invite.householdId,
			role: invite.role as Role,
			user: { displayName: input.displayName, username: input.username, passwordHash: input.passwordHash },
		});
		markInviteUsed(tx, invite.id, userId);
		return { userId };
	});
}
