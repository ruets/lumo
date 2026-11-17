// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ledgerEntries, wallets } from "../db/schema.js";
import type { ActorCtx } from "./context.js";
import type { DbOrTx, Tx } from "./members.js";

export type LedgerReason = typeof ledgerEntries.$inferInsert.reason;

export function sharedWalletId(db: DbOrTx, householdId: string): string {
	const row = db
		.select({ id: wallets.id })
		.from(wallets)
		.where(and(eq(wallets.householdId, householdId), eq(wallets.kind, "shared")))
		.get();
	if (!row) throw new Error("cagnotte du foyer manquante");
	return row.id;
}

export function personalWalletId(db: DbOrTx, householdId: string, userId: string): string {
	const row = db
		.select({ id: wallets.id })
		.from(wallets)
		.where(and(eq(wallets.householdId, householdId), eq(wallets.userId, userId)))
		.get();
	if (!row) throw new Error("porte-monnaie manquant");
	return row.id;
}

export function walletFor(db: DbOrTx, householdId: string, kind: "personal" | "shared", userId: string): string {
	return kind === "shared" ? sharedWalletId(db, householdId) : personalWalletId(db, householdId, userId);
}

/** Un solde n'est jamais stocké : somme des écritures du porte-monnaie. */
export function walletBalance(db: DbOrTx, walletId: string): number {
	const row = db
		.select({ total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)` })
		.from(ledgerEntries)
		.where(eq(ledgerEntries.walletId, walletId))
		.get();
	return row?.total ?? 0;
}

export function balancesFor(db: DbOrTx, actor: ActorCtx): { personal: number; shared: number } {
	return {
		personal: walletBalance(db, personalWalletId(db, actor.householdId, actor.userId)),
		shared: walletBalance(db, sharedWalletId(db, actor.householdId)),
	};
}

/** Seule porte d'écriture dans le journal ; l'appelant la place dans la transaction de l'action causale. */
export function addEntry(
	tx: Tx,
	entry: {
		householdId: string;
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
