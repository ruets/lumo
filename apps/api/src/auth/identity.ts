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

const adminGroup = (config: Config) => config.OIDC_ADMIN_GROUP.trim() || null;

/**
 * Rattache une identité OIDC à un utilisateur Lumo.
 *  1. `sub` déjà connu → connexion (rôle promu `owner` si groupe admin).
 *  2. Invitation fournie → création du compte avec le rôle de l'invitation.
 *  3. Aucun utilisateur dans l'instance → premier compte, `owner`, nouveau foyer.
 *  4. Sinon → refus : pas de compte sans invitation.
 */
export function resolveOidcLogin(
	db: Db,
	config: Config,
	claims: OidcClaims,
	inviteToken: string | null,
): { userId: string } {
	return writeTx(db, (tx) => {
		const displayName = claims.name?.trim() || claims.email || "Membre";

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
			const householdId = createHousehold(tx, { name: "Mon foyer" });
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

/** Premier compte de l'instance (compte local) : crée le foyer et son `owner`. */
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

/** Création d'un compte local à partir d'une invitation. */
export function registerLocal(db: Db, input: LocalAccountInput & { inviteToken: string }): { userId: string } {
	return writeTx(db, (tx) => {
		const invite = findValidInvite(tx, input.inviteToken);
		if (usernameTaken(tx, input.username)) throw errors.conflict("username_taken", "Cet identifiant est déjà pris");
		const userId = createMember(tx, {
			householdId: invite.householdId,
			role: invite.role as Role,
			user: { displayName: input.displayName, username: input.username, passwordHash: input.passwordHash },
		});
		markInviteUsed(tx, invite.id, userId);
		return { userId };
	});
}
