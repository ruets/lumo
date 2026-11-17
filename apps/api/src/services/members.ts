// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import type { Role } from "@lumo/domain";
import { count, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { households, memberships, users, wallets } from "../db/schema.js";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/** Exécute `fn` dans une transaction `BEGIN IMMEDIATE` (un seul écrivain à la fois). */
export function writeTx<T>(db: Db, fn: (tx: Tx) => T): T {
	return db.transaction(fn, { behavior: "immediate" });
}

export function createHousehold(tx: Tx, input: { name: string; timezone?: string }): string {
	const id = randomUUID();
	tx.insert(households)
		.values({ id, name: input.name, ...(input.timezone ? { timezone: input.timezone } : {}) })
		.run();
	// La cagnotte du foyer existe dès la création du foyer.
	tx.insert(wallets).values({ id: randomUUID(), householdId: id, kind: "shared", userId: null }).run();
	return id;
}

export interface NewUser {
	displayName: string;
	avatarUrl?: string | null;
	oidcSubject?: string | null;
	username?: string | null;
	email?: string | null;
	passwordHash?: string | null;
}

/** Crée un utilisateur, son appartenance au foyer et son porte-monnaie personnel. */
export function createMember(tx: Tx, input: { householdId: string; role: Role; user: NewUser }): string {
	const userId = randomUUID();
	tx.insert(users)
		.values({
			id: userId,
			displayName: input.user.displayName,
			avatarUrl: input.user.avatarUrl ?? null,
			oidcSubject: input.user.oidcSubject ?? null,
			username: input.user.username ?? null,
			email: input.user.email ?? null,
			passwordHash: input.user.passwordHash ?? null,
		})
		.run();
	tx.insert(memberships).values({ householdId: input.householdId, userId, role: input.role }).run();
	tx.insert(wallets).values({ id: randomUUID(), householdId: input.householdId, kind: "personal", userId }).run();
	return userId;
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
