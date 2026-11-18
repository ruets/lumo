// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertCanLeaveHousehold, assertCanRemoveMember, assertRoleChange, can } from "@lumo/domain";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { findValidInvite, markInviteUsed } from "../auth/invites.js";
import {
	completions,
	households,
	invites,
	itemAssignees,
	items,
	memberships,
	rewardAssignees,
	rewards,
	users,
} from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import type { householdView, memberView, updateHouseholdBody, updateMemberBody } from "../schemas.js";
import { type AccountCtx, featuresOf, type HouseholdActorCtx } from "./context.js";
import { createHousehold, type DbOrTx, joinHousehold, type Tx } from "./members.js";

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
		}));
}

/** The household, its members (visible to every member) and, for the owner, the pending invitations. */
export function getHousehold(db: DbOrTx, actor: HouseholdActorCtx, now: Date): HouseholdView {
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
		household: {
			id: h.id,
			name: h.name,
			backdateDays: h.backdateUnlimited ? null : h.backdateDays,
			potWithdrawals: h.potWithdrawals,
			features: featuresOf(h),
		},
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
	actor: HouseholdActorCtx,
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
		})
		.where(and(eq(memberships.householdId, actor.householdId), eq(memberships.userId, userId)))
		.run();
	const updated = membersOf(tx, actor.householdId).find((m) => m.userId === userId);
	if (!updated) throw notFound("Member");
	return updated;
}

/** Owner only: deletes an invitation that has not been used yet. */
export function revokeInvite(tx: Tx, actor: HouseholdActorCtx, inviteId: string): void {
	if (!can(actor, "household:manage")) throw errors.forbidden("Only an owner can revoke invitations");
	const removed = tx
		.delete(invites)
		.where(and(eq(invites.id, inviteId), eq(invites.householdId, actor.householdId), isNull(invites.usedAt)))
		.returning({ id: invites.id })
		.all();
	if (removed.length === 0) throw notFound("Invitation");
}

/** Owner only: household name and backdate window. */
export function updateHousehold(
	tx: Tx,
	actor: HouseholdActorCtx,
	input: z.output<typeof updateHouseholdBody>,
	now: Date,
): HouseholdView {
	if (!can(actor, "household:manage")) throw errors.forbidden("Only an owner can change the household");
	tx.update(households)
		.set({
			...(input.name !== undefined ? { name: input.name } : {}),
			// null turns the limit off but keeps the last number, so turning it back on starts from there.
			...(input.potWithdrawals !== undefined ? { potWithdrawals: input.potWithdrawals } : {}),
			...(input.features?.pot !== undefined ? { featurePot: input.features.pot } : {}),
			...(input.features?.wishes !== undefined ? { featureWishes: input.features.wishes } : {}),
			...(input.features?.habits !== undefined ? { featureHabits: input.features.habits } : {}),
			...(input.features?.tasks !== undefined ? { featureTasks: input.features.tasks } : {}),
			...(input.backdateDays === null ? { backdateUnlimited: true } : {}),
			...(typeof input.backdateDays === "number" ? { backdateDays: input.backdateDays, backdateUnlimited: false } : {}),
		})
		.where(eq(households.id, actor.householdId))
		.run();
	return getHousehold(tx, actor, now);
}

/**
 * Takes an account out of a household and drops what only made sense inside it: assignments to its items and
 * wishes, and approvals still waiting there (rejected). The account itself, its sessions and credentials stay, and
 * so does its personal wallet, kept as it is for if the person comes back.
 */
export function detachFromHousehold(tx: Tx, householdId: string, userId: string): void {
	const itemIds = tx.select({ id: items.id }).from(items).where(eq(items.householdId, householdId));
	const rewardIds = tx.select({ id: rewards.id }).from(rewards).where(eq(rewards.householdId, householdId));
	tx.update(completions)
		.set({ status: "rejected" })
		.where(and(eq(completions.userId, userId), eq(completions.status, "pending"), inArray(completions.itemId, itemIds)))
		.run();
	tx.delete(itemAssignees)
		.where(and(eq(itemAssignees.userId, userId), inArray(itemAssignees.itemId, itemIds)))
		.run();
	tx.delete(rewardAssignees)
		.where(and(eq(rewardAssignees.userId, userId), inArray(rewardAssignees.rewardId, rewardIds)))
		.run();
	tx.delete(memberships)
		.where(and(eq(memberships.householdId, householdId), eq(memberships.userId, userId)))
		.run();
}

function ownerCountOf(tx: Tx, householdId: string): number {
	return (
		tx
			.select({ n: sql<number>`count(*)` })
			.from(memberships)
			.where(and(eq(memberships.householdId, householdId), eq(memberships.role, "owner")))
			.get()?.n ?? 0
	);
}

/**
 * Owner only. The member leaves the household but keeps their account: they can sign in, keep their coins and join
 * another household. Never yourself, never the last owner (domain rules).
 */
export function removeMember(tx: Tx, actor: HouseholdActorCtx, userId: string): void {
	if (!can(actor, "household:manage")) throw errors.forbidden("Only an owner can remove members");
	const target = tx
		.select()
		.from(memberships)
		.where(and(eq(memberships.householdId, actor.householdId), eq(memberships.userId, userId)))
		.get();
	if (!target) throw notFound("Member");
	assertCanRemoveMember({
		actorId: actor.userId,
		targetId: userId,
		targetRole: target.role,
		ownerCount: ownerCountOf(tx, actor.householdId),
	});
	detachFromHousehold(tx, actor.householdId, userId);
}

/** Leaving on your own: allowed for everybody except the last owner. */
export function leaveHousehold(tx: Tx, actor: HouseholdActorCtx): void {
	assertCanLeaveHousehold({ role: actor.role, ownerCount: ownerCountOf(tx, actor.householdId) });
	detachFromHousehold(tx, actor.householdId, actor.userId);
}

/** An account joins a household with an invitation code (it may already belong to others). */
export function joinWithCode(tx: Tx, account: AccountCtx, code: string, now: Date): { householdId: string } {
	const invite = findValidInvite(tx, code, now);
	if (account.households.some((h) => h.id === invite.householdId)) throw errors.alreadyMember();
	joinHousehold(tx, { householdId: invite.householdId, userId: account.userId, role: invite.role });
	markInviteUsed(tx, invite.id, account.userId, now);
	return { householdId: invite.householdId };
}

/** Creating a household yourself: allowed to everybody unless the instance restricts it to super admins. */
export function createOwnHousehold(
	tx: Tx,
	account: AccountCtx,
	name: string,
	creationOpen: boolean,
): { householdId: string } {
	if (!creationOpen && !account.isSuperAdmin) throw errors.forbidden("Only super admins can create households");
	const householdId = createHousehold(tx, { name });
	joinHousehold(tx, { householdId, userId: account.userId, role: "owner" });
	return { householdId };
}
