// SPDX-License-Identifier: AGPL-3.0-or-later
import { can } from "@lumo/domain";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { createInvite } from "../auth/invites.js";
import { households, ledgerEntries, users, wallets } from "../db/schema.js";
import { errors } from "../errors.js";
import { inviteBody, inviteView, meView } from "../schemas.js";
import { route } from "./define.js";

export const meRoutes = [
	/** Profile, household, role and balances (sum of the ledger entries: no balance is stored). */
	route({
		method: "get",
		url: "/me",
		summary: "Profile, household, role and balances",
		tag: "Profile",
		response: meView,
		handler: ({ db, actor }) => {
			const user = db.select().from(users).where(eq(users.id, actor.userId)).get();
			const household = db.select().from(households).where(eq(households.id, actor.householdId)).get();
			if (!user || !household) throw errors.unauthenticated();

			const own = db
				.select()
				.from(wallets)
				.where(
					and(eq(wallets.householdId, household.id), or(eq(wallets.kind, "shared"), eq(wallets.userId, actor.userId))),
				)
				.all();
			const totals = db
				.select({ walletId: ledgerEntries.walletId, total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)` })
				.from(ledgerEntries)
				.where(
					inArray(
						ledgerEntries.walletId,
						own.map((w) => w.id),
					),
				)
				.groupBy(ledgerEntries.walletId)
				.all();
			const wallet = (kind: "personal" | "shared") => {
				const w = own.find((x) => x.kind === kind);
				if (!w) throw new Error(`${kind} wallet missing`);
				return { id: w.id, balance: totals.find((t) => t.walletId === w.id)?.total ?? 0 };
			};
			return {
				user: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
				household: { id: household.id, name: household.name, timezone: household.timezone },
				role: actor.role,
				wallets: { personal: wallet("personal"), shared: wallet("shared") },
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
