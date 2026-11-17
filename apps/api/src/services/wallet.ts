// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { can, planTransfer } from "@lumo/domain";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { z } from "zod";
import { completions, items, ledgerEntries, memberships, redemptions, rewards } from "../db/schema.js";
import { errors } from "../errors.js";
import type { ledgerEntryView } from "../schemas.js";
import type { ActorCtx } from "./context.js";
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

/** Nom de l'habitude, de la tâche ou de l'envie à l'origine des écritures (`refId` → nom). */
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

/** Virement perso → cagnotte : deux écritures liées par `transfer_id`, solde vérifié dans la même transaction. */
export function transferToShared(tx: Tx, actor: ActorCtx, amount: number, now: Date) {
	if (!can(actor, "transfer:create")) throw errors.forbidden();
	const from = personalWalletId(tx, actor.householdId, actor.userId);
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

/** Ajustement manuel (owner) : `userId` null = cagnotte. Une note explique toujours l'ajustement. */
export function adjust(
	tx: Tx,
	actor: ActorCtx,
	input: { userId: string | null; amount: number; note: string },
	now: Date,
) {
	if (!can(actor, "ledger:adjust")) throw errors.forbidden("Réservé à l'owner");
	let walletId: string;
	if (input.userId === null) {
		walletId = sharedWalletId(tx, actor.householdId);
	} else {
		const member = tx
			.select()
			.from(memberships)
			.where(and(eq(memberships.userId, input.userId), eq(memberships.householdId, actor.householdId)))
			.get();
		if (!member) throw errors.validation("body.userId : membre inconnu");
		walletId = personalWalletId(tx, actor.householdId, input.userId);
	}
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
	if (!Number.isFinite(ts) || rest.length === 0) throw errors.validation("query.cursor : curseur invalide");
	return { ts: new Date(ts), id: rest.join(":") };
}

/** Historique d'un porte-monnaie (le sien ou la cagnotte), du plus récent au plus ancien, par curseur. */
export function listLedger(
	db: DbOrTx,
	actor: ActorCtx,
	q: { wallet: "personal" | "shared"; cursor?: string | undefined; limit: number },
) {
	const walletId =
		q.wallet === "shared"
			? sharedWalletId(db, actor.householdId)
			: personalWalletId(db, actor.householdId, actor.userId);
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
