// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Actor, Role, Weekday } from "@lumo/domain";
import { eq } from "drizzle-orm";
import { households, memberships, users } from "../db/schema.js";
import type { DbOrTx } from "./members.js";

/** The actor of a request: their role and their household settings. */
export interface ActorCtx extends Actor {
	householdId: string;
	timezone: string;
	weekStart: Weekday;
	/** Days back allowed; `Number.POSITIVE_INFINITY` when the household has no limit. */
	backdateDays: number;
}

export function loadActor(db: DbOrTx, userId: string): ActorCtx | null {
	const row = db
		.select({ m: memberships, h: households })
		.from(memberships)
		.innerJoin(households, eq(households.id, memberships.householdId))
		.where(eq(memberships.userId, userId))
		.get();
	if (!row) return null;
	return {
		userId,
		role: row.m.role,
		canCreateItems: row.m.canCreateItems,
		householdId: row.h.id,
		timezone: row.h.timezone,
		weekStart: row.h.weekStart as Weekday,
		backdateDays: row.h.backdateUnlimited ? Number.POSITIVE_INFINITY : row.h.backdateDays,
	};
}

/** The account behind a request, with or without a household. */
export interface AccountCtx {
	userId: string;
	displayName: string;
	isSuperAdmin: boolean;
	household: { id: string; name: string; role: Role } | null;
}

/** `null` when the account does not exist, is disabled or was deleted: such a request is unauthenticated. */
export function loadAccount(db: DbOrTx, userId: string): AccountCtx | null {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user || user.disabledAt || user.deletedAt) return null;
	const row = db
		.select({ m: memberships, h: households })
		.from(memberships)
		.innerJoin(households, eq(households.id, memberships.householdId))
		.where(eq(memberships.userId, userId))
		.get();
	return {
		userId,
		displayName: user.displayName,
		isSuperAdmin: user.isSuperAdmin,
		household: row ? { id: row.h.id, name: row.h.name, role: row.m.role } : null,
	};
}
