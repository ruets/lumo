// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Actor, Role, Weekday } from "@lumo/domain";
import { eq } from "drizzle-orm";
import { households, memberships, users } from "../db/schema.js";
import { errors } from "../errors.js";
import type { DbOrTx } from "./members.js";

/** One membership of the actor, with what the household sets for them. */
export interface MembershipCtx {
	householdId: string;
	role: Role;
	canCreateItems: boolean;
	/** Days back allowed in this household; `Number.POSITIVE_INFINITY` when it has no limit. */
	backdateDays: number;
}

/**
 * The actor of a request. `role`, `canCreateItems`, `householdId` and `backdateDays` describe their *active*
 * household: the one named by the `X-Household-Id` header when they belong to it, otherwise their oldest
 * membership. Without any household the account still acts on its own personal items, wishes and coins, as an
 * adult who can create items. Rights on an item or wish come from the household it belongs to (`actorIn`), not
 * from the active one. Time zone and first weekday belong to the person.
 */
export interface ActorCtx extends Actor {
	householdId: string | null;
	memberships: MembershipCtx[];
	timezone: string;
	weekStart: Weekday;
	backdateDays: number;
}

/** An actor known to be in a household: what household routes receive. */
export type HouseholdActorCtx = ActorCtx & { householdId: string };

export const inHousehold = (actor: ActorCtx): actor is HouseholdActorCtx => actor.householdId !== null;

/** The same person acting inside one household (their rights there), or on their own space for `null`. */
export function actorIn(actor: ActorCtx, householdId: string | null): ActorCtx {
	if (householdId === null) {
		return { ...actor, householdId: null, role: "adult", canCreateItems: true, backdateDays: Number.POSITIVE_INFINITY };
	}
	const m = actor.memberships.find((x) => x.householdId === householdId);
	if (!m) throw errors.notFound("Household");
	return { ...actor, householdId, role: m.role, canCreateItems: m.canCreateItems, backdateDays: m.backdateDays };
}

export function membershipsOf(db: DbOrTx, userId: string): MembershipCtx[] {
	return db
		.select({ m: memberships, h: households })
		.from(memberships)
		.innerJoin(households, eq(households.id, memberships.householdId))
		.where(eq(memberships.userId, userId))
		.orderBy(memberships.createdAt, memberships.householdId)
		.all()
		.map(({ m, h }) => ({
			householdId: h.id,
			role: m.role,
			canCreateItems: m.canCreateItems,
			backdateDays: h.backdateUnlimited ? Number.POSITIVE_INFINITY : h.backdateDays,
		}));
}

/** `null` when the account does not exist, is disabled or was deleted. */
export function loadActor(db: DbOrTx, userId: string, preferredHouseholdId?: string | null): ActorCtx | null {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user || user.disabledAt || user.deletedAt) return null;
	const list = membershipsOf(db, userId);
	const base: ActorCtx = {
		userId,
		role: "adult",
		canCreateItems: true,
		householdId: null,
		memberships: list,
		timezone: user.timezone,
		weekStart: user.weekStart as Weekday,
		backdateDays: Number.POSITIVE_INFINITY,
	};
	const active = list.find((m) => m.householdId === preferredHouseholdId) ?? list[0];
	return active ? actorIn(base, active.householdId) : base;
}

/** The account behind a request, with or without households. */
export interface AccountCtx {
	userId: string;
	displayName: string;
	isSuperAdmin: boolean;
	households: { id: string; name: string; role: Role }[];
}

/** `null` when the account does not exist, is disabled or was deleted: such a request is unauthenticated. */
export function loadAccount(db: DbOrTx, userId: string): AccountCtx | null {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user || user.disabledAt || user.deletedAt) return null;
	const rows = db
		.select({ m: memberships, h: households })
		.from(memberships)
		.innerJoin(households, eq(households.id, memberships.householdId))
		.where(eq(memberships.userId, userId))
		.orderBy(memberships.createdAt, memberships.householdId)
		.all();
	return {
		userId,
		displayName: user.displayName,
		isSuperAdmin: user.isSuperAdmin,
		households: rows.map((r) => ({ id: r.h.id, name: r.h.name, role: r.m.role })),
	};
}
