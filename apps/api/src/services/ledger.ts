// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ledgerEntries, wallets } from "../db/schema.js";
import { errors } from "../errors.js";
import type { ActorCtx } from "./context.js";
import type { DbOrTx, Tx } from "./members.js";

export type LedgerReason = typeof ledgerEntries.$inferInsert.reason;

export function sharedWalletId(db: DbOrTx, householdId: string): string {
	const row = db
		.select({ id: wallets.id })
		.from(wallets)
		.where(and(eq(wallets.householdId, householdId), eq(wallets.kind, "shared")))
		.get();
	if (!row) throw new Error("household pot missing");
	return row.id;
}

export function personalWalletId(db: DbOrTx, userId: string): string {
	const row = db
		.select({ id: wallets.id })
		.from(wallets)
		.where(and(eq(wallets.kind, "personal"), eq(wallets.userId, userId)))
		.get();
	if (!row) throw new Error("wallet missing");
	return row.id;
}

/** The wallet of a kind for this person; the pot needs a household. */
export function walletFor(db: DbOrTx, kind: "personal" | "shared", userId: string, householdId: string | null): string {
	if (kind === "personal") return personalWalletId(db, userId);
	if (!householdId) throw errors.noHousehold();
	return sharedWalletId(db, householdId);
}

/** A balance is never stored: sum of the wallet's entries. */
export function walletBalance(db: DbOrTx, walletId: string): number {
	const row = db
		.select({ total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)` })
		.from(ledgerEntries)
		.where(eq(ledgerEntries.walletId, walletId))
		.get();
	return row?.total ?? 0;
}

export function balancesFor(db: DbOrTx, actor: ActorCtx): { personal: number; shared: number | null } {
	return {
		personal: walletBalance(db, personalWalletId(db, actor.userId)),
		shared: actor.householdId ? walletBalance(db, sharedWalletId(db, actor.householdId)) : null,
	};
}

/** The only way to write to the ledger; the caller puts it in the causing action's transaction. */
export function addEntry(
	tx: Tx,
	entry: {
		householdId: string | null;
		walletId: string;
		amount: number;
		reason: LedgerReason;
		refId?: string | null;
		transferId?: string | null;
		note?: string | null;
		createdBy: string;
		now: Date;
	},
): string {
	const id = randomUUID();
	tx.insert(ledgerEntries)
		.values({
			id,
			householdId: entry.householdId,
			walletId: entry.walletId,
			amount: entry.amount,
			reason: entry.reason,
			refId: entry.refId ?? null,
			transferId: entry.transferId ?? null,
			note: entry.note ?? null,
			createdBy: entry.createdBy,
			createdAt: entry.now,
		})
		.run();
	return id;
}
