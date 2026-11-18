// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { assertFeature, can, planTransfer } from "@lumo/domain";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { z } from "zod";
import { completions, items, ledgerEntries, memberships, redemptions, rewards } from "../db/schema.js";
import { errors } from "../errors.js";
import type { ledgerEntryView } from "../schemas.js";
import { type ActorCtx, type HouseholdActorCtx, requireRight } from "./context.js";
import { addEntry, balancesFor, personalWalletId, sharedWalletId, walletBalance } from "./ledger.js";
import type { DbOrTx, Tx } from "./members.js";

type EntryRow = typeof ledgerEntries.$inferSelect;
type EntryView = z.input<typeof ledgerEntryView>;

const toEntryView = (e: EntryRow, label: string | null = null): EntryView => ({
	id: e.id,
	walletId: e.walletId,
	amount: e.amount,
	reason: e.reason,
	refId: e.refId,
	transferId: e.transferId,
	note: e.note,
	createdBy: e.createdBy,
	createdAt: e.createdAt.toISOString(),
	label,
});

/** Name of the habit, task or wish behind the entries (`refId` → name). */
function labelsFor(db: DbOrTx, rows: EntryRow[]): Map<string, string> {
	const labels = new Map<string, string>();
	const byCompletion = rows.filter((r) => (r.reason === "completion" || r.reason === "undo") && r.refId);
	if (byCompletion.length > 0) {
		const found = db
			.select({ id: completions.id, name: items.name })
			.from(completions)
			.innerJoin(items, eq(items.id, completions.itemId))
			.where(
				inArray(
					completions.id,
					byCompletion.map((r) => r.refId as string),
				),
			)
			.all();
		for (const f of found) labels.set(f.id, f.name);
	}
	const byRedemption = rows.filter((r) => (r.reason === "redemption" || r.reason === "undo") && r.refId);
	if (byRedemption.length > 0) {
		const found = db
			.select({ id: redemptions.id, name: rewards.name })
			.from(redemptions)
			.innerJoin(rewards, eq(rewards.id, redemptions.rewardId))
			.where(
				inArray(
					redemptions.id,
					byRedemption.map((r) => r.refId as string),
				),
			)
			.all();
		for (const f of found) labels.set(f.id, f.name);
	}
	return labels;
}

/** Personal → pot transfer: two entries linked by `transfer_id`, balance checked in the same transaction. */
export function transferToShared(tx: Tx, actor: HouseholdActorCtx, amount: number, now: Date) {
	if (!can(actor, "transfer:create")) throw errors.forbidden();
	assertFeature(actor.features, "pot");
	requireRight(actor, "transfer");
	const from = personalWalletId(tx, actor.userId);
	const to = sharedWalletId(tx, actor.householdId);
	const [debit, credit] = planTransfer({ balance: walletBalance(tx, from), amount });
	const transferId = randomUUID();
	for (const [walletId, leg] of [
		[from, debit],
		[to, credit],
	] as const) {
		addEntry(tx, {
			householdId: actor.householdId,
			walletId,
			amount: leg.amount,
			reason: "transfer",
			transferId,
			createdBy: actor.userId,
			now,
		});
	}
	return { transferId, balances: balancesFor(tx, actor) };
}

/**
 * Pot → your own wallet, when the household policy lets you (owners by default, never a supervised account).
 * Two entries linked by `transfer_id`, balance checked in the same transaction.
 */
export function withdrawFromPot(tx: Tx, actor: HouseholdActorCtx, amount: number, now: Date) {
	assertFeature(actor.features, "pot");
	if (!can(actor, "pot:withdraw")) throw errors.potLocked();
	const from = sharedWalletId(tx, actor.householdId);
	const to = personalWalletId(tx, actor.userId);
	return movePotCoins(tx, actor, { from, to, amount, now });
}

/** An owner pays a member out of the pot: never yourself (that is a withdrawal, governed by the policy). */
export function payoutFromPot(tx: Tx, actor: HouseholdActorCtx, userId: string, amount: number, now: Date) {
	assertFeature(actor.features, "pot");
	if (!can(actor, "pot:payout")) throw errors.forbidden("Only an owner can pay out of the pot");
	if (userId === actor.userId) throw errors.validation("userId: paying yourself is a withdrawal");
	const member = tx
		.select()
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.householdId, actor.householdId)))
		.get();
	if (!member) throw errors.validation("body.userId: unknown member");
	const from = sharedWalletId(tx, actor.householdId);
	const to = personalWalletId(tx, userId);
	return movePotCoins(tx, actor, { from, to, amount, now });
}

function movePotCoins(tx: Tx, actor: HouseholdActorCtx, m: { from: string; to: string; amount: number; now: Date }) {
	const [debit, credit] = planTransfer({ balance: walletBalance(tx, m.from), amount: m.amount });
	const transferId = randomUUID();
	for (const [walletId, leg] of [
		[m.from, debit],
		[m.to, credit],
	] as const) {
		addEntry(tx, {
			householdId: actor.householdId,
			walletId,
			amount: leg.amount,
			reason: "transfer",
			transferId,
			createdBy: actor.userId,
			now: m.now,
		});
	}
	return { transferId, balances: balancesFor(tx, actor) };
}

/**
 * Manual adjustment of the household pot (owner). A note always explains it. Nobody adjusts a personal wallet
 * through a household: guardians correct their wards' coins, and nobody adjusts their own.
 */
export function adjust(tx: Tx, actor: HouseholdActorCtx, input: { amount: number; note: string }, now: Date) {
	if (!can(actor, "ledger:adjust")) throw errors.forbidden("Owner only");
	assertFeature(actor.features, "pot");
	const walletId = sharedWalletId(tx, actor.householdId);
	const id = addEntry(tx, {
		householdId: actor.householdId,
		walletId,
		amount: input.amount,
		reason: "adjustment",
		note: input.note,
		createdBy: actor.userId,
		now,
	});
	return { entry: toEntryView(tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, id)).get() as EntryRow) };
}

const encodeCursor = (e: EntryRow) => Buffer.from(`${e.createdAt.getTime()}:${e.id}`).toString("base64url");

function decodeCursor(cursor: string): { ts: Date; id: string } {
	const [ms, ...rest] = Buffer.from(cursor, "base64url").toString().split(":");
	const ts = Number(ms);
	if (!Number.isFinite(ts) || rest.length === 0) throw errors.validation("query.cursor: invalid cursor");
	return { ts: new Date(ts), id: rest.join(":") };
}

/** History of a wallet (your own or the pot), newest first, by cursor. */
export function listLedger(
	db: DbOrTx,
	actor: ActorCtx,
	q: { wallet: "personal" | "shared"; cursor?: string | undefined; limit: number },
) {
	if (q.wallet === "shared" && !actor.householdId) throw errors.noHousehold();
	if (q.wallet === "shared") assertFeature(actor.features, "pot");
	const walletId =
		q.wallet === "shared" && actor.householdId
			? sharedWalletId(db, actor.householdId)
			: personalWalletId(db, actor.userId);
	const c = q.cursor ? decodeCursor(q.cursor) : null;
	const rows = db
		.select()
		.from(ledgerEntries)
		.where(
			and(
				eq(ledgerEntries.walletId, walletId),
				c
					? or(lt(ledgerEntries.createdAt, c.ts), and(eq(ledgerEntries.createdAt, c.ts), lt(ledgerEntries.id, c.id)))
					: undefined,
			),
		)
		.orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
		.limit(q.limit + 1)
		.all();
	const page = rows.slice(0, q.limit);
	const last = page[page.length - 1];
	const labels = labelsFor(db, page);
	return {
		wallet: q.wallet,
		walletId,
		balance: walletBalance(db, walletId),
		entries: page.map((e) => toEntryView(e, e.refId ? (labels.get(e.refId) ?? null) : null)),
		nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
	};
}
