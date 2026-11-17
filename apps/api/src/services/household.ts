// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertRoleChange, can } from "@lumo/domain";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { households, invites, memberships, users } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import type { householdView, memberView, updateMemberBody } from "../schemas.js";
import type { ActorCtx } from "./context.js";
import type { DbOrTx, Tx } from "./members.js";

type MemberView = z.input<typeof memberView>;
type HouseholdView = z.input<typeof householdView>;

const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);

function membersOf(db: DbOrTx, householdId: string): MemberView[] {
	return db
		.select({ m: memberships, u: users })
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(eq(memberships.householdId, householdId))
		.orderBy(memberships.createdAt, users.displayName)
		.all()
		.map(({ m, u }) => ({
			userId: u.id,
			displayName: u.displayName,
			role: m.role,
			canCreateItems: m.canCreateItems,
		}));
}

/** The household, its members (visible to every member) and, for the owner, the pending invitations. */
export function getHousehold(db: DbOrTx, actor: ActorCtx, now: Date): HouseholdView {
	const h = db.select().from(households).where(eq(households.id, actor.householdId)).get();
	if (!h) throw errors.unauthenticated();
	const pending = can(actor, "household:manage")
		? db
				.select()
				.from(invites)
				.where(and(eq(invites.householdId, actor.householdId), isNull(invites.usedAt), gt(invites.expiresAt, now)))
				.orderBy(invites.createdAt)
				.all()
		: [];
	return {
		household: { id: h.id, name: h.name, timezone: h.timezone, weekStart: h.weekStart, backdateDays: h.backdateDays },
		members: membersOf(db, actor.householdId),
		invites: pending.map((i) => ({
			id: i.id,
			role: i.role,
			expiresAt: i.expiresAt.toISOString(),
			createdAt: i.createdAt.toISOString(),
		})),
	};
}

/** Owner only. A household always keeps at least one owner (domain rule). */
export function updateMember(
	tx: Tx,
	actor: ActorCtx,
	userId: string,
	input: z.output<typeof updateMemberBody>,
): MemberView {
	if (!can(actor, "household:manage")) throw errors.forbidden("Only an owner can manage members");
	const target = tx
		.select()
		.from(memberships)
		.where(and(eq(memberships.householdId, actor.householdId), eq(memberships.userId, userId)))
		.get();
	if (!target) throw notFound("Member");

	if (input.role !== undefined) {
		const ownerCount =
			tx
				.select({ n: sql<number>`count(*)` })
				.from(memberships)
				.where(and(eq(memberships.householdId, actor.householdId), eq(memberships.role, "owner")))
				.get()?.n ?? 0;
		assertRoleChange({ currentRole: target.role, newRole: input.role, ownerCount });
	}

	tx.update(memberships)
		.set({
			...(input.role !== undefined ? { role: input.role } : {}),
			...(input.canCreateItems !== undefined ? { canCreateItems: input.canCreateItems } : {}),
		})
		.where(and(eq(memberships.householdId, actor.householdId), eq(memberships.userId, userId)))
		.run();
	const updated = membersOf(tx, actor.householdId).find((m) => m.userId === userId);
	if (!updated) throw notFound("Member");
	return updated;
}

/** Owner only: deletes an invitation that has not been used yet. */
export function revokeInvite(tx: Tx, actor: ActorCtx, inviteId: string): void {
	if (!can(actor, "household:manage")) throw errors.forbidden("Only an owner can revoke invitations");
	const removed = tx
		.delete(invites)
		.where(and(eq(invites.id, inviteId), eq(invites.householdId, actor.householdId), isNull(invites.usedAt)))
		.returning({ id: invites.id })
		.all();
	if (removed.length === 0) throw notFound("Invitation");
}
