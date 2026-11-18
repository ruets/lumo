// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { assertCanSupervise, DEFAULT_WARD_RIGHTS, type WardRights } from "@lumo/domain";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { hashToken, randomToken } from "../auth/tokens.js";
import { completions, guardianshipCodes, guardianships, items, users } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import { type ActorCtx, loadActor, wardRightsOf } from "./context.js";
import { addEntry, personalWalletId, walletBalance } from "./ledger.js";
import { createAccount, type DbOrTx, type Tx, usernameTaken } from "./members.js";

export const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const notFound = () => new AppError(404, "not_found", "Ward not found");

function isGuardianOf(db: DbOrTx, guardianId: string, wardId: string): boolean {
	return (
		db
			.select({ id: guardianships.id })
			.from(guardianships)
			.where(and(eq(guardianships.guardianId, guardianId), eq(guardianships.wardId, wardId)))
			.get() !== undefined
	);
}

/** Throws 404 unless `guardianId` supervises `wardId`: nothing is revealed about accounts you do not supervise. */
export function assertGuardian(db: DbOrTx, guardianId: string, wardId: string): void {
	if (!isGuardianOf(db, guardianId, wardId)) throw notFound();
}

/**
 * The ward's own space, as seen by their guardian: same items, wishes, coins, but free of the ward's own
 * supervision limits (the guardian is the one who sets them). `null` when the account is not theirs to supervise.
 */
export function loadWardActor(
	db: DbOrTx,
	guardianId: string,
	wardId: string,
	preferredHouseholdId?: string | null,
): ActorCtx | null {
	assertGuardian(db, guardianId, wardId);
	const actor = loadActor(db, wardId, preferredHouseholdId);
	return actor ? { ...actor, supervised: null } : null;
}

// ---- Codes ------------------------------------------------------------------------------

export function createCode(tx: Tx, userId: string, kind: "supervise" | "be_supervised", now: Date) {
	const token = randomToken();
	const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
	tx.insert(guardianshipCodes)
		.values({ id: randomUUID(), tokenHash: hashToken(token), kind, createdBy: userId, expiresAt, createdAt: now })
		.run();
	return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * Redeeming a code completes the consent: the code's creator and the redeemer become guardian and ward. A ward
 * that gets its first guardian starts with the strict default rights.
 */
export function redeemCode(tx: Tx, userId: string, token: string, now: Date): void {
	const code = tx
		.select()
		.from(guardianshipCodes)
		.where(
			and(
				eq(guardianshipCodes.tokenHash, hashToken(token)),
				isNull(guardianshipCodes.usedAt),
				gt(guardianshipCodes.expiresAt, now),
			),
		)
		.get();
	if (!code) throw errors.invalidCode();
	const guardianId = code.kind === "supervise" ? code.createdBy : userId;
	const wardId = code.kind === "supervise" ? userId : code.createdBy;
	startSupervision(tx, guardianId, wardId);
	tx.update(guardianshipCodes).set({ usedAt: now, usedBy: userId }).where(eq(guardianshipCodes.id, code.id)).run();
}

export function startSupervision(tx: Tx, guardianId: string, wardId: string): void {
	assertCanSupervise({
		guardianId,
		wardId,
		alreadySupervising: isGuardianOf(tx, guardianId, wardId),
		guardianIsSupervised: wardRightsOf(tx, guardianId) !== null,
		wardSupervisesGuardian: isGuardianOf(tx, wardId, guardianId),
	});
	const first = wardRightsOf(tx, wardId) === null;
	tx.insert(guardianships).values({ id: randomUUID(), guardianId, wardId }).run();
	if (first) tx.update(users).set(DEFAULT_WARD_RIGHTS).where(eq(users.id, wardId)).run();
}

// ---- Views ------------------------------------------------------------------------------

const nameOf = (db: DbOrTx, id: string) =>
	db.select({ displayName: users.displayName }).from(users).where(eq(users.id, id)).get()?.displayName ?? "";

export function supervisionView(db: DbOrTx, userId: string) {
	const guardians = db
		.select({ id: users.id, displayName: users.displayName })
		.from(guardianships)
		.innerJoin(users, eq(users.id, guardianships.guardianId))
		.where(eq(guardianships.wardId, userId))
		.orderBy(asc(guardianships.createdAt), asc(users.id))
		.all();
	const wards = db
		.select({ id: users.id, displayName: users.displayName })
		.from(guardianships)
		.innerJoin(users, eq(users.id, guardianships.wardId))
		.where(eq(guardianships.guardianId, userId))
		.orderBy(asc(guardianships.createdAt), asc(users.id))
		.all();
	return {
		guardians,
		rights: wardRightsOf(db, userId),
		wards: wards.map((w) => ({ ...w, rights: wardRightsOf(db, w.id) as WardRights })),
	};
}

// ---- Guardian powers ----------------------------------------------------------------------

export function endSupervision(tx: Tx, guardianId: string, wardId: string): void {
	assertGuardian(tx, guardianId, wardId);
	tx.delete(guardianships)
		.where(and(eq(guardianships.guardianId, guardianId), eq(guardianships.wardId, wardId)))
		.run();
}

export function updateWardRights(tx: Tx, guardianId: string, wardId: string, patch: Partial<WardRights>) {
	assertGuardian(tx, guardianId, wardId);
	const set: Partial<WardRights> = {};
	for (const k of ["canCreate", "canModify", "canDelete", "canTransfer"] as const) {
		if (patch[k] !== undefined) set[k] = patch[k];
	}
	if (Object.keys(set).length > 0) tx.update(users).set(set).where(eq(users.id, wardId)).run();
	return { id: wardId, displayName: nameOf(tx, wardId), rights: wardRightsOf(tx, wardId) as WardRights };
}

/** A guardian creates a local account for a child: already supervised by them, with the strict default rights. */
export function createWardAccount(
	tx: Tx,
	guardianId: string,
	input: { displayName: string; username: string; passwordHash: string },
) {
	if (usernameTaken(tx, input.username)) throw errors.conflict("username_taken", "This username is already taken");
	const wardId = createAccount(tx, input);
	startSupervision(tx, guardianId, wardId);
	return { id: wardId, displayName: input.displayName, rights: wardRightsOf(tx, wardId) as WardRights };
}

/** A guardian corrects their ward's coins (never their own: this only ever touches the ward's wallet). */
export function adjustWard(
	tx: Tx,
	guardianId: string,
	wardId: string,
	input: { amount: number; note: string },
	now: Date,
) {
	assertGuardian(tx, guardianId, wardId);
	const walletId = personalWalletId(tx, wardId);
	addEntry(tx, {
		householdId: null,
		walletId,
		amount: input.amount,
		reason: "adjustment",
		note: input.note,
		createdBy: guardianId,
		now,
	});
	return { balance: walletBalance(tx, walletId) };
}

/** Completions of the ward waiting for approval, in every household they belong to and in their personal space. */
export function listWardPending(db: DbOrTx, guardianId: string, wardId: string) {
	assertGuardian(db, guardianId, wardId);
	return db
		.select({ c: completions, name: items.name })
		.from(completions)
		.innerJoin(items, eq(items.id, completions.itemId))
		.where(and(eq(completions.userId, wardId), eq(completions.status, "pending"), isNull(completions.undoneAt)))
		.all();
}

/** Completions waiting for this guardian's approval, across all their wards. */
export function listPendingForGuardian(db: DbOrTx, guardianId: string) {
	return db
		.select({ c: completions, name: items.name, wardId: users.id, wardName: users.displayName })
		.from(guardianships)
		.innerJoin(completions, eq(completions.userId, guardianships.wardId))
		.innerJoin(items, eq(items.id, completions.itemId))
		.innerJoin(users, eq(users.id, guardianships.wardId))
		.where(
			and(eq(guardianships.guardianId, guardianId), eq(completions.status, "pending"), isNull(completions.undoneAt)),
		)
		.all();
}
