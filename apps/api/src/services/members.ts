// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import type { Role } from "@lumo/domain";
import { count, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { households, memberships, users, wallets } from "../db/schema.js";
import { errors } from "../errors.js";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/** Runs `fn` in a `BEGIN IMMEDIATE` transaction (one writer at a time). */
export function writeTx<T>(db: Db, fn: (tx: Tx) => T): T {
	return db.transaction(fn, { behavior: "immediate" });
}

export function createHousehold(tx: Tx, input: { name: string; timezone?: string }): string {
	const id = randomUUID();
	tx.insert(households)
		.values({ id, name: input.name, ...(input.timezone ? { timezone: input.timezone } : {}) })
		.run();
	// The household pot exists from the moment the household is created.
	tx.insert(wallets).values({ id: randomUUID(), householdId: id, kind: "shared", userId: null }).run();
	return id;
}

export interface NewUser {
	displayName: string;
	avatarUrl?: string | null;
	oidcSubject?: string | null;
	oidcIssuer?: string | null;
	username?: string | null;
	email?: string | null;
	passwordHash?: string | null;
	isSuperAdmin?: boolean;
}

/** Creates an account with no household. */
export function createAccount(tx: Tx, user: NewUser): string {
	const userId = randomUUID();
	tx.insert(users)
		.values({
			id: userId,
			displayName: user.displayName,
			avatarUrl: user.avatarUrl ?? null,
			oidcSubject: user.oidcSubject ?? null,
			oidcIssuer: user.oidcSubject ? (user.oidcIssuer ?? "") : null,
			username: user.username ?? null,
			email: user.email ?? null,
			passwordHash: user.passwordHash ?? null,
			isSuperAdmin: user.isSuperAdmin ?? false,
		})
		.run();
	// Coins belong to the account: the personal wallet exists from the start and follows it between households.
	tx.insert(wallets).values({ id: randomUUID(), householdId: null, kind: "personal", userId }).run();
	return userId;
}

/** Puts an existing account into a household with the given role. */
export function joinHousehold(tx: Tx, input: { householdId: string; userId: string; role: Role }): void {
	const target = tx
		.select({ archivedAt: households.archivedAt })
		.from(households)
		.where(eq(households.id, input.householdId))
		.get();
	if (target?.archivedAt) throw errors.conflict("household_archived", "This household is archived");
	tx.insert(memberships).values({ householdId: input.householdId, userId: input.userId, role: input.role }).run();
}

/** Creates an account together with its household membership and personal wallet. */
export function createMember(tx: Tx, input: { householdId: string; role: Role; user: NewUser }): string {
	const userId = createAccount(tx, input.user);
	joinHousehold(tx, { householdId: input.householdId, userId, role: input.role });
	return userId;
}

export function superAdminCount(db: DbOrTx): number {
	return db.select({ n: count() }).from(users).where(eq(users.isSuperAdmin, true)).get()?.n ?? 0;
}

export function userCount(db: DbOrTx): number {
	return db.select({ n: count() }).from(users).get()?.n ?? 0;
}

export function firstHouseholdId(db: DbOrTx): string | null {
	return db.select({ id: households.id }).from(households).limit(1).get()?.id ?? null;
}

export function usernameTaken(db: DbOrTx, username: string): boolean {
	return db.select({ id: users.id }).from(users).where(eq(users.username, username)).get() !== undefined;
}
