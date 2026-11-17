// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { can, localDate, periodStart, planRedemption } from "@lumo/domain";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { memberships, redemptions, rewardAssignees, rewards } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import type { createRewardBody, rewardView, updateRewardBody } from "../schemas.js";
import type { ActorCtx } from "./context.js";
import { addEntry, balancesFor, walletBalance, walletFor } from "./ledger.js";
import type { DbOrTx, Tx } from "./members.js";

type RewardRow = typeof rewards.$inferSelect;
type RewardView = z.input<typeof rewardView>;

const notFound = () => new AppError(404, "not_found", "Envie introuvable");

function assigneesOf(db: DbOrTx, ids: string[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	if (ids.length === 0) return map;
	for (const r of db.select().from(rewardAssignees).where(inArray(rewardAssignees.rewardId, ids)).all()) {
		map.set(r.rewardId, [...(map.get(r.rewardId) ?? []), r.userId]);
	}
	return map;
}

const toView = (r: RewardRow, assigneeIds: string[]): RewardView => ({
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
});

function assertMembers(db: DbOrTx, actor: ActorCtx, ids: string[]) {
	if (ids.length === 0) return;
	const found = db
		.select({ id: memberships.userId })
		.from(memberships)
		.where(and(eq(memberships.householdId, actor.householdId), inArray(memberships.userId, ids)))
		.all();
	if (found.length !== ids.length) throw errors.validation("assigneeIds : un assigné n'est pas membre du foyer");
}

function getRewardRow(db: DbOrTx, actor: ActorCtx, id: string, opts: { allowArchived?: boolean } = {}): RewardRow {
	const row = db
		.select()
		.from(rewards)
		.where(and(eq(rewards.id, id), eq(rewards.householdId, actor.householdId)))
		.get();
	if (!row || (row.archivedAt && !opts.allowArchived)) throw notFound();
	return row;
}

export function createReward(tx: Tx, actor: ActorCtx, input: z.output<typeof createRewardBody>, now: Date): RewardView {
	if (!can(actor, "reward:manage")) throw errors.forbidden("Réservé aux adultes");
	const assigneeIds = [...new Set(input.assigneeIds)];
	assertMembers(tx, actor, assigneeIds);
	const id = randomUUID();
	tx.insert(rewards)
		.values({
			id,
			householdId: actor.householdId,
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

/** Adultes : toutes les envies actives. Enfants : celles qu'ils peuvent échanger. */
export function listRewards(db: DbOrTx, actor: ActorCtx): RewardView[] {
	const rows = db
		.select()
		.from(rewards)
		.where(and(eq(rewards.householdId, actor.householdId), isNull(rewards.archivedAt)))
		.all();
	const assignees = assigneesOf(
		db,
		rows.map((r) => r.id),
	);
	return rows
		.map((r) => toView(r, assignees.get(r.id) ?? []))
		.filter(
			(v) =>
				actor.role !== "child" || can(actor, "reward:redeem", { fundedFrom: v.fundedFrom, assigneeIds: v.assigneeIds }),
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
	if (!can(actor, "reward:manage")) throw errors.forbidden("Réservé aux adultes");
	const row = getRewardRow(tx, actor, id, { allowArchived: true });

	const limitCount = input.limitCount !== undefined ? input.limitCount : row.limitCount;
	const limitPeriod = input.limitPeriod !== undefined ? input.limitPeriod : row.limitPeriod;
	if ((limitCount === null) !== (limitPeriod === null))
		throw errors.validation("limitCount et limitPeriod vont ensemble");

	if (input.assigneeIds) {
		const ids = [...new Set(input.assigneeIds)];
		assertMembers(tx, actor, ids);
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
 * Échanger une envie : droits, limite par période, solde, puis écriture `−cost` et ligne d'échange,
 * le tout dans la transaction `BEGIN IMMEDIATE` de la requête (pas de solde négatif possible).
 */
export function redeemReward(tx: Tx, actor: ActorCtx, rewardId: string, now: Date) {
	const reward = getRewardRow(tx, actor, rewardId);
	const assigneeIds = assigneesOf(tx, [rewardId]).get(rewardId) ?? [];
	if (!can(actor, "reward:redeem", { fundedFrom: reward.fundedFrom, assigneeIds })) {
		throw errors.forbidden("Tu ne peux pas échanger cette envie");
	}

	const today = localDate(now, actor.timezone);
	let usedInPeriod = 0;
	if (reward.limitPeriod) {
		const start = periodStart(reward.limitPeriod, today, actor.weekStart);
		usedInPeriod = tx
			.select({ at: redemptions.redeemedAt })
			.from(redemptions)
			.where(
				and(
					eq(redemptions.rewardId, rewardId),
					eq(redemptions.userId, actor.userId),
					// marge d'un jour : le filtre exact se fait en jour local, fuseau du foyer compris
					gte(redemptions.redeemedAt, new Date(now.getTime() - 400 * 86_400_000)),
				),
			)
			.all()
			.filter((r) => localDate(r.at, actor.timezone) >= start).length;
	}

	const walletId = walletFor(tx, actor.householdId, reward.fundedFrom, actor.userId);
	const { amount } = planRedemption({
		cost: reward.cost,
		balance: walletBalance(tx, walletId),
		usedInPeriod,
		limitCount: reward.limitCount,
	});

	const id = randomUUID();
	const ledgerEntryId = addEntry(tx, {
		householdId: actor.householdId,
		walletId,
		amount,
		reason: "redemption",
		refId: id,
		createdBy: actor.userId,
		now,
	});
	tx.insert(redemptions).values({ id, rewardId, userId: actor.userId, walletId, redeemedAt: now, ledgerEntryId }).run();
	return {
		redemption: { id, rewardId, userId: actor.userId, walletId, redeemedAt: now.toISOString() },
		balances: balancesFor(tx, actor),
	};
}
