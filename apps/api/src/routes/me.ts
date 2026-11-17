// SPDX-License-Identifier: AGPL-3.0-or-later
import { can } from "@lumo/domain";
import { eq } from "drizzle-orm";
import { createInvite } from "../auth/invites.js";
import { households, users } from "../db/schema.js";
import { errors } from "../errors.js";
import { inviteBody, inviteView, meView } from "../schemas.js";
import { balancesFor, personalWalletId, sharedWalletId } from "../services/ledger.js";
import { route } from "./define.js";

export const meRoutes = [
	/** Profile, household, role and balances (sum of the ledger entries: no balance is stored). */
	route({
		method: "get",
		url: "/me",
		summary: "Profile, household, role and balances",
		tag: "Profile",
		scope: "account",
		response: meView,
		handler: ({ db, actor }) => {
			const user = db.select().from(users).where(eq(users.id, actor.userId)).get();
			if (!user) throw errors.unauthenticated();
			const household = actor.householdId
				? (db.select().from(households).where(eq(households.id, actor.householdId)).get() ?? null)
				: null;
			const balances = balancesFor(db, actor);
			return {
				user: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
				household: household ? { id: household.id, name: household.name, timezone: household.timezone } : null,
				role: household ? actor.role : null,
				wallets: {
					personal: { id: personalWalletId(db, actor.userId), balance: balances.personal },
					shared:
						household && balances.shared !== null
							? { id: sharedWalletId(db, household.id), balance: balances.shared }
							: null,
				},
			};
		},
	}),
	route({
		method: "post",
		url: "/household/invites",
		summary: "Invite a member (owner)",
		tag: "Household",
		body: inviteBody,
		response: inviteView,
		status: 201,
		idempotent: false,
		handler: ({ db, actor, body, now }) => {
			if (!can(actor, "household:manage")) throw errors.forbidden("Only an owner can invite");
			const invite = createInvite(db, {
				householdId: actor.householdId,
				role: body.role,
				createdBy: actor.userId,
				now,
			});
			return { token: invite.token, expiresAt: invite.expiresAt.toISOString() };
		},
	}),
];
