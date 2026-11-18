// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import {
	assertUnderTarget,
	can,
	checkCompletionDate,
	DomainError,
	isDue,
	localDate,
	planCompletion,
	scheduleSchema,
} from "@lumo/domain";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { completions, itemAssignees, items, ledgerEntries, memberships } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import type { completionView } from "../schemas.js";
import { type ActorCtx, actorIn, type HouseholdActorCtx } from "./context.js";
import { accessibleItems, getActiveItem } from "./items.js";
import { addEntry, balancesFor, walletFor } from "./ledger.js";
import type { DbOrTx, Tx } from "./members.js";

type CompletionRow = typeof completions.$inferSelect;
export type CompletionView = z.input<typeof completionView>;

export function toCompletionView(c: CompletionRow): CompletionView {
	return {
		id: c.id,
		itemId: c.itemId,
		userId: c.userId,
		localDate: c.localDate,
		status: c.status,
		approvedBy: c.approvedBy,
		completedAt: c.completedAt.toISOString(),
		undoneAt: c.undoneAt?.toISOString() ?? null,
	};
}

/** Completions that count toward the goal: active, approved or pending. `date` null = all dates. */
export function countActive(db: DbOrTx, itemId: string, userId: string, date: string | null): number {
	return (
		db
			.select({ n: count() })
			.from(completions)
			.where(
				and(
					eq(completions.itemId, itemId),
					eq(completions.userId, userId),
					date ? eq(completions.localDate, date) : undefined,
					isNull(completions.undoneAt),
					inArray(completions.status, ["pending", "approved"]),
				),
			)
			.get()?.n ?? 0
	);
}

/** Role of a person in a household; adult when they are not a member (never used to grant more than adult). */
function roleOf(db: DbOrTx, householdId: string, userId: string) {
	const row = db
		.select({ role: memberships.role })
		.from(memberships)
		.where(and(eq(memberships.householdId, householdId), eq(memberships.userId, userId)))
		.get();
	return row?.role ?? "adult";
}

function getCompletion(db: DbOrTx, actor: ActorCtx, id: string) {
	const row = db
		.select({ c: completions, i: items })
		.from(completions)
		.innerJoin(items, eq(items.id, completions.itemId))
		.where(and(eq(completions.id, id), accessibleItems(actor)))
		.get();
	if (!row) throw new AppError(404, "not_found", "Completion not found");
	return row;
}

const result = (tx: DbOrTx, actor: ActorCtx, c: CompletionRow) => ({
	completion: toCompletionView(c),
	balances: balancesFor(tx, actor),
});

/**
 * Complete an item. A single transaction: checks, completion and coin entry.
 * The client never sends an amount; the reward comes from the item.
 */
export function createCompletion(
	tx: Tx,
	actor: ActorCtx,
	itemId: string,
	input: { date?: string | undefined },
	now: Date,
) {
	const item = getActiveItem(tx, actor, itemId);
	// Rights and backdate window come from the household the item belongs to.
	const as = actorIn(actor, item.householdId);
	const assigned = tx
		.select()
		.from(itemAssignees)
		.where(and(eq(itemAssignees.itemId, itemId), eq(itemAssignees.userId, actor.userId)))
		.get();
	if (!assigned || !can(as, "completion:create", { userId: actor.userId })) {
		throw errors.forbidden("This item is not assigned to you");
	}

	const today = localDate(now, actor.timezone);
	const date = input.date ?? today;
	checkCompletionDate({ date, today, windowDays: as.backdateDays, role: as.role });

	if (item.kind === "habit" && !isDue(scheduleSchema.parse(item.schedule), date)) {
		throw new DomainError("not_due", "This habit is not planned that day");
	}
	// A task is completed only once, whatever the date.
	assertUnderTarget(countActive(tx, itemId, actor.userId, item.kind === "habit" ? date : null), item.targetPerPeriod);

	const plan = planCompletion({ actorRole: as.role, requiresApproval: item.requiresApproval, reward: item.reward });
	const id = randomUUID();
	let ledgerEntryId: string | null = null;
	if (plan.credit > 0) {
		ledgerEntryId = addEntry(tx, {
			householdId: item.householdId,
			walletId: walletFor(tx, item.creditsTo, actor.userId, item.householdId),
			amount: plan.credit,
			reason: "completion",
			refId: id,
			createdBy: actor.userId,
			now,
		});
	}
	tx.insert(completions)
		.values({ id, itemId, userId: actor.userId, localDate: date, status: plan.status, completedAt: now, ledgerEntryId })
		.run();
	return result(tx, actor, tx.select().from(completions).where(eq(completions.id, id)).get() as CompletionRow);
}

/** Undo: `undone_at` + counter-entry of the exact amount paid. */
export function undoCompletion(tx: Tx, actor: ActorCtx, id: string, now: Date) {
	const { c, i } = getCompletion(tx, actor, id);
	const owner = i.householdId ? roleOf(tx, i.householdId, c.userId) : "adult";
	if (!can(actorIn(actor, i.householdId), "completion:undo", { userId: c.userId, userRole: owner })) {
		throw errors.forbidden("Undo not allowed");
	}
	if (c.undoneAt) throw errors.conflict("already_undone", "This completion is already undone");

	tx.update(completions).set({ undoneAt: now }).where(eq(completions.id, id)).run();
	if (c.status === "approved" && c.ledgerEntryId) {
		const original = tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, c.ledgerEntryId)).get();
		if (original) {
			addEntry(tx, {
				householdId: original.householdId,
				walletId: original.walletId,
				amount: -original.amount,
				reason: "undo",
				refId: id,
				createdBy: actor.userId,
				now,
			});
		}
	}
	return result(tx, actor, tx.select().from(completions).where(eq(completions.id, id)).get() as CompletionRow);
}

function pendingOnly(c: CompletionRow) {
	if (c.status !== "pending" || c.undoneAt) throw errors.conflict("not_pending", "This completion is not pending");
}

export function approveCompletion(tx: Tx, actor: ActorCtx, id: string, now: Date) {
	const { c, i } = getCompletion(tx, actor, id);
	if (!can(actorIn(actor, i.householdId), "completion:approve", { userId: c.userId })) {
		throw errors.forbidden("Approval not allowed");
	}
	pendingOnly(c);

	let ledgerEntryId: string | null = null;
	if (i.reward > 0) {
		ledgerEntryId = addEntry(tx, {
			householdId: i.householdId,
			// The reward goes to the wallet of the person who completed it, not the approver.
			walletId: walletFor(tx, i.creditsTo, c.userId, i.householdId),
			amount: i.reward,
			reason: "completion",
			refId: id,
			createdBy: actor.userId,
			now,
		});
	}
	tx.update(completions)
		.set({ status: "approved", approvedBy: actor.userId, ledgerEntryId })
		.where(eq(completions.id, id))
		.run();
	return result(tx, actor, tx.select().from(completions).where(eq(completions.id, id)).get() as CompletionRow);
}

export function rejectCompletion(tx: Tx, actor: ActorCtx, id: string) {
	const { c, i } = getCompletion(tx, actor, id);
	if (!can(actorIn(actor, i.householdId), "completion:approve", { userId: c.userId })) {
		throw errors.forbidden("Rejection not allowed");
	}
	pendingOnly(c);
	tx.update(completions).set({ status: "rejected", approvedBy: actor.userId }).where(eq(completions.id, id)).run();
	return result(tx, actor, tx.select().from(completions).where(eq(completions.id, id)).get() as CompletionRow);
}

/** Completions waiting for approval, for the actor's household. */
export function listPending(db: DbOrTx, actor: HouseholdActorCtx): CompletionView[] {
	if (!can(actor, "completion:review")) throw errors.forbidden("Adults only");
	return db
		.select({ c: completions })
		.from(completions)
		.innerJoin(items, eq(items.id, completions.itemId))
		.where(
			and(eq(items.householdId, actor.householdId), eq(completions.status, "pending"), isNull(completions.undoneAt)),
		)
		.all()
		.map((r) => toCompletionView(r.c));
}
