// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Actor, Weekday } from "@lumo/domain";
import { eq } from "drizzle-orm";
import { households, memberships } from "../db/schema.js";
import type { DbOrTx } from "./members.js";

/** L'acteur d'une requête : son rôle et les réglages de son foyer. */
export interface ActorCtx extends Actor {
	householdId: string;
	timezone: string;
	weekStart: Weekday;
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
		backdateDays: row.h.backdateDays,
	};
}
