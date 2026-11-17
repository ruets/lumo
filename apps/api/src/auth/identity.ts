// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Role, roleAfterOidcLogin } from "@lumo/domain";
import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { memberships, users } from "../db/schema.js";
import { errors } from "../errors.js";
import { createHousehold, createMember, userCount, usernameTaken, writeTx } from "../services/members.js";
import { findValidInvite, markInviteUsed } from "./invites.js";
import type { OidcClaims } from "./oidc.js";

const adminGroup = (config: Config) => config.OIDC_ADMIN_GROUP ?? null;

/**
 * Links an OIDC identity to a Lumo user.
 *  1. Known `sub` → sign-in (role promoted to `owner` if in the admin group).
 *  2. Invitation provided → account created with the invitation's role.
 *  3. No user in the instance → first account, `owner`, new household.
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

		const existing = tx.select().from(users).where(eq(users.oidcSubject, claims.sub)).get();
		if (existing) {
			const membership = tx.select().from(memberships).where(eq(memberships.userId, existing.id)).get();
			if (membership) {
				const role = roleAfterOidcLogin(membership.role, claims.groups, adminGroup(config));
				if (role !== membership.role) {
					tx.update(memberships).set({ role }).where(eq(memberships.userId, existing.id)).run();
				}
			}
			if (claims.picture && claims.picture !== existing.avatarUrl) {
				tx.update(users).set({ avatarUrl: claims.picture }).where(eq(users.id, existing.id)).run();
			}
			return { userId: existing.id };
		}

		const newUser = {
			displayName,
			avatarUrl: claims.picture,
			oidcSubject: claims.sub,
			email: claims.email,
		};

		if (inviteToken) {
			const invite = findValidInvite(tx, inviteToken);
			const role = roleAfterOidcLogin(invite.role, claims.groups, adminGroup(config));
			const userId = createMember(tx, { householdId: invite.householdId, role, user: newUser });
			markInviteUsed(tx, invite.id, userId);
			return { userId };
		}

		if (userCount(tx) === 0) {
			const householdId = createHousehold(tx, { name: "My household" });
			return { userId: createMember(tx, { householdId, role: "owner", user: newUser }) };
		}

		throw errors.invitationRequired();
	});
}

export interface LocalAccountInput {
	username: string;
	displayName: string;
	passwordHash: string;
}

/** First account of the instance (local account): creates the household and its `owner`. */
export function setupInstance(db: Db, input: LocalAccountInput & { householdName: string }): { userId: string } {
	return writeTx(db, (tx) => {
		if (userCount(tx) > 0) throw errors.setupDone();
		const householdId = createHousehold(tx, { name: input.householdName });
		const userId = createMember(tx, {
			householdId,
			role: "owner",
			user: { displayName: input.displayName, username: input.username, passwordHash: input.passwordHash },
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
