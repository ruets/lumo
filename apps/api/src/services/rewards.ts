// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { can, localDate, periodStart, planRedemption } from "@lumo/domain";
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import { ledgerEntries, memberships, redemptions, rewardAssignees, rewards } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import type { createRewardBody, rewardView, updateRewardBody } from "../schemas.js";
import { type ActorCtx, inHousehold } from "./context.js";
import { addEntry, balancesFor, walletBalance, walletFor } from "./ledger.js";
import type { DbOrTx, Tx } from "./members.js";

type RewardRow = typeof rewards.$inferSelect;
type RewardView = z.input<typeof rewardView>;

const notFound = () => new AppError(404, "not_found", "Wish not found");

function assigneesOf(db: DbOrTx, ids: string[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	if (ids.length === 0) return map;
	for (const r of db.select().from(rewardAssignees).where(inArray(rewardAssignees.rewardId, ids)).all()) {
		map.set(r.rewardId, [...(map.get(r.rewardId) ?? []), r.userId]);
	}
	return map;
}

const toView = (r: RewardRow, assigneeIds: string[], remaining: number | null = null): RewardView => ({
	id: r.id,
	name: r.name,
	description: r.description,
	cost: r.cost,
	fundedFrom: r.fundedFrom,
	limitCount: r.limitCount,
	limitPeriod: r.limitPeriod,
	link: r.link,
	archivedAt: r.archivedAt?.toISOString() ?? null,
	assigneeIds,
	scope: r.householdId ? "household" : "personal",
	remaining,
});

const accessibleRewards = (actor: ActorCtx) =>
	or(eq(rewards.ownerId, actor.userId), actor.householdId ? eq(rewards.householdId, actor.householdId) : undefined);

/** The actor's redemptions in the current limit period (household local days). */
function usedInPeriodOf(db: DbOrTx, actor: ActorCtx, reward: RewardRow, now: Date): number {
	if (!reward.limitPeriod) return 0;
	const start = periodStart(reward.limitPeriod, localDate(now, actor.timezone), actor.weekStart);
	return db
		.select({ at: redemptions.redeemedAt })
		.from(redemptions)
		.where(
			and(
				eq(redemptions.rewardId, reward.id),
				eq(redemptions.userId, actor.userId),
				isNull(redemptions.undoneAt),
				// one-day margin: the exact filter is done in local days, household time zone included
				gte(redemptions.redeemedAt, new Date(now.getTime() - 400 * 86_400_000)),
			),
		)
		.all()
		.filter((r) => localDate(r.at, actor.timezone) >= start).length;
}

function assertMembers(db: DbOrTx, householdId: string, ids: string[]) {
	if (ids.length === 0) return;
	const found = db
		.select({ id: memberships.userId })
		.from(memberships)
		.where(and(eq(memberships.householdId, householdId), inArray(memberships.userId, ids)))
		.all();
	if (found.length !== ids.length) throw errors.validation("assigneeIds: an assignee is not a member of the household");
}

function getRewardRow(db: DbOrTx, actor: ActorCtx, id: string, opts: { allowArchived?: boolean } = {}): RewardRow {
	const row = db
		.select()
		.from(rewards)
		.where(and(eq(rewards.id, id), accessibleRewards(actor)))
		.get();
	if (!row || (row.archivedAt && !opts.allowArchived)) throw notFound();
	return row;
}

export function createReward(tx: Tx, actor: ActorCtx, input: z.output<typeof createRewardBody>, now: Date): RewardView {
	const scope = input.scope ?? (inHousehold(actor) ? "household" : "personal");
	if (scope === "household" && !actor.householdId) throw errors.noHousehold();
	const assigneeIds = [...new Set(input.assigneeIds)];
	if (scope === "household") {
		if (!can(actor, "reward:manage")) throw errors.forbidden("Adults only");
		assertMembers(tx, actor.householdId as string, assigneeIds);
	} else {
		// A personal wish is yours alone and paid from your own coins.
		if (assigneeIds.length > 0) throw errors.validation("assigneeIds: a personal wish is yours alone");
		if (input.fundedFrom !== "personal") throw errors.validation("fundedFrom: a personal wish uses your own coins");
	}
	const id = randomUUID();
	tx.insert(rewards)
		.values({
			id,
			householdId: scope === "household" ? actor.householdId : null,
			ownerId: scope === "personal" ? actor.userId : null,
			name: input.name,
			description: input.description ?? null,
			cost: input.cost,
			fundedFrom: input.fundedFrom,
			limitCount: input.limitCount ?? null,
			limitPeriod: input.limitPeriod ?? null,
			link: input.link ?? null,
			createdAt: now,
		})
		.run();
	if (assigneeIds.length)
		tx.insert(rewardAssignees)
			.values(assigneeIds.map((userId) => ({ rewardId: id, userId })))
			.run();
	return toView(tx.select().from(rewards).where(eq(rewards.id, id)).get() as RewardRow, assigneeIds);
}

/** Adults: all active wishes. Children: the ones they can redeem. */
export function listRewards(db: DbOrTx, actor: ActorCtx, now: Date): RewardView[] {
	const rows = db
		.select()
		.from(rewards)
		.where(and(accessibleRewards(actor), isNull(rewards.archivedAt)))
		.all();
	const assignees = assigneesOf(
		db,
		rows.map((r) => r.id),
	);
	return rows
		.map((r) =>
			toView(
				r,
				assignees.get(r.id) ?? [],
				r.limitCount === null ? null : Math.max(0, r.limitCount - usedInPeriodOf(db, actor, r, now)),
			),
		)
		.filter(
			(v) =>
				v.scope === "personal" ||
				actor.role !== "child" ||
				can(actor, "reward:redeem", { fundedFrom: v.fundedFrom, assigneeIds: v.assigneeIds }),
		)
		.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, "fr"));
}

export function updateReward(
	tx: Tx,
	actor: ActorCtx,
	id: string,
	input: z.output<typeof updateRewardBody>,
	now: Date,
): RewardView {
	const row = getRewardRow(tx, actor, id, { allowArchived: true });
	if (row.householdId && !can(actor, "reward:manage")) throw errors.forbidden("Adults only");
	if (!row.householdId) {
		if (input.assigneeIds && input.assigneeIds.length > 0)
			throw errors.validation("assigneeIds: a personal wish is yours alone");
		if (input.fundedFrom === "shared") throw errors.validation("fundedFrom: a personal wish uses your own coins");
	}

	const limitCount = input.limitCount !== undefined ? input.limitCount : row.limitCount;
	const limitPeriod = input.limitPeriod !== undefined ? input.limitPeriod : row.limitPeriod;
	if ((limitCount === null) !== (limitPeriod === null))
		throw errors.validation("limitCount and limitPeriod go together");

	if (input.assigneeIds && row.householdId) {
		const ids = [...new Set(input.assigneeIds)];
		assertMembers(tx, row.householdId, ids);
		tx.delete(rewardAssignees).where(eq(rewardAssignees.rewardId, id)).run();
		if (ids.length)
			tx.insert(rewardAssignees)
				.values(ids.map((userId) => ({ rewardId: id, userId })))
				.run();
	}
	const patch: Partial<typeof rewards.$inferInsert> = { limitCount, limitPeriod };
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) patch.description = input.description;
	if (input.cost !== undefined) patch.cost = input.cost;
	if (input.fundedFrom !== undefined) patch.fundedFrom = input.fundedFrom;
	if (input.link !== undefined) patch.link = input.link;
	if (input.archived !== undefined) patch.archivedAt = input.archived ? (row.archivedAt ?? now) : null;
	tx.update(rewards).set(patch).where(eq(rewards.id, id)).run();

	return toView(
		tx.select().from(rewards).where(eq(rewards.id, id)).get() as RewardRow,
		assigneesOf(tx, [id]).get(id) ?? [],
	);
}

/**
 * Redeem a wish: rights, per-period limit, balance, then a `−cost` entry and a redemption row,
 * all inside the request's `BEGIN IMMEDIATE` transaction (a negative balance is impossible).
 */
export function redeemReward(tx: Tx, actor: ActorCtx, rewardId: string, now: Date) {
	const reward = getRewardRow(tx, actor, rewardId);
	const assigneeIds = assigneesOf(tx, [rewardId]).get(rewardId) ?? [];
	if (reward.householdId && !can(actor, "reward:redeem", { fundedFrom: reward.fundedFrom, assigneeIds })) {
		throw errors.forbidden("You cannot redeem this wish");
	}

	const usedInPeriod = usedInPeriodOf(tx, actor, reward, now);

	const walletId = walletFor(tx, reward.fundedFrom, actor.userId, actor.householdId);
	const { amount } = planRedemption({
		cost: reward.cost,
		balance: walletBalance(tx, walletId),
		usedInPeriod,
		limitCount: reward.limitCount,
	});

	const id = randomUUID();
	const ledgerEntryId = addEntry(tx, {
		householdId: reward.householdId,
		walletId,
		amount,
		reason: "redemption",
		refId: id,
		createdBy: actor.userId,
		now,
	});
	tx.insert(redemptions).values({ id, rewardId, userId: actor.userId, walletId, redeemedAt: now, ledgerEntryId }).run();
	return {
		redemption: { id, rewardId, userId: actor.userId, walletId, redeemedAt: now.toISOString(), undoneAt: null },
		balances: balancesFor(tx, actor),
	};
}

/**
 * Undo a redemption: `undone_at` + counter-entry of the exact amount paid, in the original wallet
 * (personal or pot). The period's usage limit is freed; the ledger is never modified.
 */
export function undoRedemption(tx: Tx, actor: ActorCtx, id: string, now: Date) {
	const row = tx
		.select({ r: redemptions })
		.from(redemptions)
		.innerJoin(rewards, eq(rewards.id, redemptions.rewardId))
		.where(and(eq(redemptions.id, id), accessibleRewards(actor)))
		.get();
	if (!row) throw notFound();
	const { r } = row;
	const owner = tx.select().from(memberships).where(eq(memberships.userId, r.userId)).get();
	if (!can(actor, "redemption:undo", { userId: r.userId, userRole: owner?.role ?? "adult" })) {
		throw errors.forbidden("Undo not allowed");
	}
	if (r.undoneAt) throw errors.conflict("already_undone", "This redemption is already undone");

	tx.update(redemptions).set({ undoneAt: now }).where(eq(redemptions.id, id)).run();
	const original = tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, r.ledgerEntryId)).get();
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
	return {
		redemption: {
			id,
			rewardId: r.rewardId,
			userId: r.userId,
			walletId: r.walletId,
			redeemedAt: r.redeemedAt.toISOString(),
			undoneAt: now.toISOString(),
		},
		balances: balancesFor(tx, actor),
	};
}
