// SPDX-License-Identifier: AGPL-3.0-or-later
import { can } from "@lumo/domain";
import { eq } from "drizzle-orm";
import { createInvite } from "../auth/invites.js";
import { users } from "../db/schema.js";
import { errors } from "../errors.js";
import { inviteBody, inviteView, meView } from "../schemas.js";
import { personalWalletId, sharedWalletId, walletBalance } from "../services/ledger.js";
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
			const list = actor.memberships.map((m) => {
				const potId = sharedWalletId(db, m.householdId);
				return {
					id: m.householdId,
					name: m.name,
					role: m.role,
					pot: m.features.pot ? { id: potId, balance: walletBalance(db, potId) } : null,
					features: m.features,
				};
			});
			const active = list.find((h) => h.id === actor.householdId) ?? null;
			return {
				user: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
				household: active ? { id: active.id, name: active.name } : null,
				role: active ? active.role : null,
				households: list,
				wallets: {
					personal: {
						id: personalWalletId(db, actor.userId),
						balance: walletBalance(db, personalWalletId(db, actor.userId)),
					},
					shared: active ? active.pot : null,
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
