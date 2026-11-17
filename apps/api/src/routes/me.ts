// SPDX-License-Identifier: AGPL-3.0-or-later
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "../auth/guard.js";
import { createInvite } from "../auth/invites.js";
import type { Db } from "../db/client.js";
import { households, ledgerEntries, memberships, users, wallets } from "../db/schema.js";
import { errors } from "../errors.js";

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerMeRoutes(app: FastifyInstance, db: Db, requireAuth: Guard) {
	/** Profil, foyer, rôle et soldes (somme des écritures du journal : aucun solde n'est stocké). */
	app.get("/me", { preHandler: requireAuth }, async (req) => {
		const { userId } = req.auth as AuthContext;
		const row = db
			.select({ user: users, household: households, role: memberships.role })
			.from(memberships)
			.innerJoin(users, eq(users.id, memberships.userId))
			.innerJoin(households, eq(households.id, memberships.householdId))
			.where(eq(memberships.userId, userId))
			.get();
		if (!row) throw errors.unauthenticated();

		const ownWallets = db
			.select()
			.from(wallets)
			.where(and(eq(wallets.householdId, row.household.id), or(eq(wallets.kind, "shared"), eq(wallets.userId, userId))))
			.all();
		const totals = db
			.select({ walletId: ledgerEntries.walletId, total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)` })
			.from(ledgerEntries)
			.where(
				inArray(
					ledgerEntries.walletId,
					ownWallets.map((w) => w.id),
				),
			)
			.groupBy(ledgerEntries.walletId)
			.all();
		const wallet = (kind: "personal" | "shared") => {
			const w = ownWallets.find((x) => x.kind === kind);
			if (!w) throw new Error(`porte-monnaie ${kind} manquant`);
			return { id: w.id, balance: totals.find((t) => t.walletId === w.id)?.total ?? 0 };
		};

		return {
			user: { id: row.user.id, displayName: row.user.displayName, avatarUrl: row.user.avatarUrl },
			household: { id: row.household.id, name: row.household.name, timezone: row.household.timezone },
			role: row.role,
			wallets: { personal: wallet("personal"), shared: wallet("shared") },
		};
	});

	const inviteBody = z.object({ role: z.enum(["adult", "child"]) });

	/** Invitation à rejoindre le foyer (owner uniquement ; la matrice `can()` complète arrive à l'étape 2). */
	app.post("/household/invites", { preHandler: requireAuth }, async (req, reply) => {
		const { userId } = req.auth as AuthContext;
		const membership = db.select().from(memberships).where(eq(memberships.userId, userId)).get();
		if (!membership) throw errors.unauthenticated();
		if (membership.role !== "owner") throw errors.forbidden("Seul un owner peut inviter");
		const parsed = inviteBody.safeParse(req.body);
		if (!parsed.success) throw errors.validation("role doit valoir adult ou child");
		const invite = createInvite(db, { householdId: membership.householdId, role: parsed.data.role, createdBy: userId });
		return reply.code(201).send({ token: invite.token, expiresAt: invite.expiresAt.toISOString() });
	});
}
