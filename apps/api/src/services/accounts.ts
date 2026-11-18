// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Role } from "@lumo/domain";
import { assertInstanceAccessChange } from "@lumo/domain";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { devices, households, ledgerEntries, memberships, sessions, users } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import type { AccountCtx } from "./context.js";
import { detachFromHousehold } from "./household.js";
import { addEntry, sharedWalletId, walletBalance } from "./ledger.js";
import { createHousehold, type DbOrTx, joinHousehold, superAdminCount, type Tx } from "./members.js";
import { endAllSupervisionsOf } from "./supervision.js";

const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);
const iso = (d: Date) => d.toISOString();

function householdsOf(db: DbOrTx, userId: string) {
	return db
		.select({ id: households.id, name: households.name, role: memberships.role })
		.from(memberships)
		.innerJoin(households, eq(households.id, memberships.householdId))
		.where(eq(memberships.userId, userId))
		.orderBy(memberships.createdAt, households.id)
		.all();
}

function userView(db: DbOrTx, u: typeof users.$inferSelect) {
	return {
		id: u.id,
		displayName: u.displayName,
		username: u.username,
		oidc: u.oidcSubject !== null,
		isSuperAdmin: u.isSuperAdmin,
		disabled: u.disabledAt !== null,
		households: householdsOf(db, u.id),
		createdAt: iso(u.createdAt),
	};
}

function liveUser(db: DbOrTx, id: string) {
	const u = db
		.select()
		.from(users)
		.where(and(eq(users.id, id), isNull(users.deletedAt)))
		.get();
	if (!u) throw notFound("Account");
	return u;
}

/** Accounts with their household and status: never any content (items, coins, history). */
export function listUsers(db: DbOrTx) {
	const rows = db
		.select()
		.from(users)
		.where(isNull(users.deletedAt))
		.orderBy(asc(users.createdAt), asc(users.id))
		.all();
	return { users: rows.map((u) => userView(db, u)) };
}

export function updateUser(
	tx: Tx,
	actor: AccountCtx,
	targetId: string,
	input: { isSuperAdmin?: boolean | undefined; disabled?: boolean | undefined },
) {
	const target = liveUser(tx, targetId);
	const base = {
		actorId: actor.userId,
		targetId,
		targetIsSuperAdmin: target.isSuperAdmin,
		superAdminCount: superAdminCount(tx),
	};
	if (input.isSuperAdmin === false && target.isSuperAdmin) assertInstanceAccessChange({ ...base, action: "demote" });
	if (input.disabled === true) assertInstanceAccessChange({ ...base, action: "disable" });
	const set: Partial<typeof users.$inferInsert> = {};
	if (input.isSuperAdmin !== undefined) set.isSuperAdmin = input.isSuperAdmin;
	if (input.disabled !== undefined) set.disabledAt = input.disabled ? new Date() : null;
	if (Object.keys(set).length > 0) tx.update(users).set(set).where(eq(users.id, targetId)).run();
	if (input.disabled === true) tx.delete(sessions).where(eq(sessions.userId, targetId)).run();
	return userView(tx, liveUser(tx, targetId));
}

/**
 * Deletes an account: credentials and sessions are erased, it leaves its household and disappears from lists.
 * The row stays so that history (ledger, completions) keeps a name; the username becomes free again.
 */
export function deleteUser(tx: Tx, actor: AccountCtx, targetId: string, now: Date) {
	const target = liveUser(tx, targetId);
	assertInstanceAccessChange({
		action: "delete",
		actorId: actor.userId,
		targetId,
		targetIsSuperAdmin: target.isSuperAdmin,
		superAdminCount: superAdminCount(tx),
	});
	for (const home of householdsOf(tx, targetId)) detachFromHousehold(tx, home.id, targetId);
	endAllSupervisionsOf(tx, targetId);
	tx.delete(sessions).where(eq(sessions.userId, targetId)).run();
	tx.delete(devices).where(eq(devices.userId, targetId)).run();
	tx.update(users)
		.set({
			username: null,
			passwordHash: null,
			oidcSubject: null,
			oidcIssuer: null,
			email: null,
			isSuperAdmin: false,
			disabledAt: now,
			deletedAt: now,
		})
		.where(eq(users.id, targetId))
		.run();
}

export function assignHousehold(tx: Tx, targetId: string, input: { householdId: string; role: Role }) {
	const target = liveUser(tx, targetId);
	if (householdsOf(tx, targetId).some((h) => h.id === input.householdId)) throw errors.alreadyMember();
	if (!tx.select({ id: households.id }).from(households).where(eq(households.id, input.householdId)).get()) {
		throw notFound("Household");
	}
	joinHousehold(tx, { householdId: input.householdId, userId: targetId, role: input.role });
	return userView(tx, target);
}

export function removeFromHousehold(tx: Tx, targetId: string, householdId: string) {
	liveUser(tx, targetId);
	if (!householdsOf(tx, targetId).some((h) => h.id === householdId)) throw notFound("Membership");
	detachFromHousehold(tx, householdId, targetId);
}

// ---- Households -------------------------------------------------------------------------

function householdView(db: DbOrTx, h: typeof households.$inferSelect) {
	const members = db.select({ n: count() }).from(memberships).where(eq(memberships.householdId, h.id)).get()?.n ?? 0;
	return { id: h.id, name: h.name, memberCount: members, createdAt: iso(h.createdAt) };
}

function household(db: DbOrTx, id: string) {
	const h = db.select().from(households).where(eq(households.id, id)).get();
	if (!h) throw notFound("Household");
	return h;
}

export function listHouseholds(db: DbOrTx) {
	const rows = db.select().from(households).orderBy(asc(households.createdAt), asc(households.id)).all();
	return { households: rows.map((h) => householdView(db, h)) };
}

export function adminCreateHousehold(tx: Tx, name: string) {
	return householdView(tx, household(tx, createHousehold(tx, { name })));
}

export function renameHousehold(tx: Tx, id: string, name: string) {
	household(tx, id);
	tx.update(households).set({ name }).where(eq(households.id, id)).run();
	return householdView(tx, household(tx, id));
}

/** Only an empty household can be deleted: members must be moved or removed first. */
export function deleteHousehold(tx: Tx, id: string) {
	household(tx, id);
	if (householdView(tx, household(tx, id)).memberCount > 0) {
		throw errors.conflict("household_not_empty", "Remove the members before deleting the household");
	}
	// Ledger entries are append-only and would be wiped with the household: one that ever moved coins stays.
	if (tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.householdId, id)).get()) {
		throw errors.conflict("household_has_history", "This household has coin history and cannot be deleted");
	}
	tx.delete(households).where(eq(households.id, id)).run();
}

/** A super admin corrects a household pot (never sees what is in it); the note explains why. */
export function adjustPot(
	tx: Tx,
	actor: AccountCtx,
	householdId: string,
	input: { amount: number; note: string },
	now: Date,
) {
	household(tx, householdId);
	const walletId = sharedWalletId(tx, householdId);
	addEntry(tx, {
		householdId,
		walletId,
		amount: input.amount,
		reason: "adjustment",
		note: input.note,
		createdBy: actor.userId,
		now,
	});
	return { balance: walletBalance(tx, walletId) };
}

/** The person's own settings: name, time zone, first weekday. */
export function updateAccount(
	tx: Tx,
	userId: string,
	input: { displayName?: string | undefined; timezone?: string | undefined; weekStart?: number | undefined },
) {
	const set: Partial<typeof users.$inferInsert> = {};
	if (input.displayName !== undefined) set.displayName = input.displayName;
	if (input.timezone !== undefined) set.timezone = input.timezone;
	if (input.weekStart !== undefined) set.weekStart = input.weekStart;
	if (Object.keys(set).length > 0) tx.update(users).set(set).where(eq(users.id, userId)).run();
}
