// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import {
	assertFeature,
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
import { completions, itemAssignees, items, ledgerEntries } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import type { completionView } from "../schemas.js";
import { type ActorCtx, actorIn } from "./context.js";
import { accessibleItems, getActiveItem } from "./items.js";
import { addEntry, balancesFor, walletFor } from "./ledger.js";
import type { DbOrTx, Tx } from "./members.js";
import { assertGuardian } from "./supervision.js";

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

	// An item that pays the pot cannot be completed while its household has the pot switched off.
	if (item.householdId && item.creditsTo === "shared" && item.reward > 0) assertFeature(as.features, "pot");

	// A supervised account needs its guardians' approval on items that ask for it.
	const plan = planCompletion({
		supervised: actor.supervised !== null,
		requiresApproval: item.requiresApproval,
		reward: item.reward,
	});
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
	if (!can(actorIn(actor, i.householdId), "completion:undo", { userId: c.userId })) {
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

/** Credits the reward of a pending completion to the wallet of whoever completed it, then marks it approved. */
function applyApproval(tx: Tx, approverId: string, c: CompletionRow, i: typeof items.$inferSelect, now: Date) {
	let ledgerEntryId: string | null = null;
	if (i.reward > 0) {
		ledgerEntryId = addEntry(tx, {
			householdId: i.householdId,
			// The reward goes to the wallet of the person who completed it, not the approver.
			walletId: walletFor(tx, i.creditsTo, c.userId, i.householdId),
			amount: i.reward,
			reason: "completion",
			refId: c.id,
			createdBy: approverId,
			now,
		});
	}
	tx.update(completions)
		.set({ status: "approved", approvedBy: approverId, ledgerEntryId })
		.where(eq(completions.id, c.id))
		.run();
}

/** A guardian approves or rejects a completion of their ward, whichever household the item belongs to. */
export function reviewAsGuardian(tx: Tx, guardianId: string, ward: ActorCtx, id: string, approve: boolean, now: Date) {
	assertGuardian(tx, guardianId, ward.userId);
	const row = tx
		.select({ c: completions, i: items })
		.from(completions)
		.innerJoin(items, eq(items.id, completions.itemId))
		.where(and(eq(completions.id, id), eq(completions.userId, ward.userId)))
		.get();
	if (!row) throw new AppError(404, "not_found", "Completion not found");
	pendingOnly(row.c);
	if (approve) applyApproval(tx, guardianId, row.c, row.i, now);
	else tx.update(completions).set({ status: "rejected", approvedBy: guardianId }).where(eq(completions.id, id)).run();
	return result(tx, ward, tx.select().from(completions).where(eq(completions.id, id)).get() as CompletionRow);
}
