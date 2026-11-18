// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Role } from "./roles.js";
import type { WardRights } from "./supervision.js";

/** Who may take coins out of a household pot: its owners, all its members, or nobody. */
export const POT_POLICIES = ["owners", "members", "nobody"] as const;
export type PotPolicy = (typeof POT_POLICIES)[number];

export interface Actor {
	userId: string;
	/** Role in the household the action happens in. */
	role: Role;
	/** What the person's guardians allow; `null` when they have none. Enforced separately for create/modify/delete. */
	supervised: WardRights | null;
	/** Withdrawal policy of the household the action happens in (irrelevant outside a household). */
	potWithdrawals: PotPolicy;
}

/**
 * Taking coins out of the pot (to your own wallet, or by paying a shared wish) follows the household policy.
 * A supervised account never withdraws, and nobody withdraws on a ward's behalf: guardians only give.
 */
export function canWithdrawFromPot(actor: Actor): boolean {
	if (actor.supervised !== null) return false;
	switch (actor.potWithdrawals) {
		case "owners":
			return actor.role === "owner";
		case "members":
			return true;
		case "nobody":
			return false;
	}
}

/** Each action and the resource its decision depends on. */
export interface Abilities {
	"item:create": { assigneeIds: readonly string[] };
	"item:update": { createdBy: string };
	"completion:create": { userId: string };
	"completion:undo": { userId: string };
	"completion:backdate": { daysAgo: number; windowDays: number };
	"redemption:undo": { userId: string };
	"reward:redeem": { fundedFrom: "personal" | "shared"; assigneeIds: readonly string[] };
	"transfer:create": undefined;
	"pot:withdraw": undefined;
	"pot:payout": undefined;
	"ledger:adjust": undefined;
	"household:manage": undefined;
}

export type Action = keyof Abilities;

/**
 * Rights matrix (docs/ARCHITECTURE.md). Checked on the server, never on the client alone. What a supervised
 * account may create, change, delete or give is limited on top of this by its guardians (`supervisionAllows`).
 */
export function can<A extends Action>(
	actor: Actor,
	action: A,
	...[resource]: Abilities[A] extends undefined ? [] : [Abilities[A]]
): boolean {
	const r = resource as Abilities[Action];
	switch (action) {
		case "item:create":
		case "item:update":
		case "transfer:create":
			return true;
		case "completion:create":
			return (r as Abilities["completion:create"]).userId === actor.userId;
		case "completion:undo":
		case "redemption:undo": {
			const { userId } = r as Abilities["completion:undo"] | Abilities["redemption:undo"];
			return userId === actor.userId || actor.role === "owner";
		}
		case "completion:backdate": {
			const { daysAgo, windowDays } = r as Abilities["completion:backdate"];
			return daysAgo <= windowDays || actor.role === "owner";
		}
		case "reward:redeem": {
			const { fundedFrom, assigneeIds } = r as Abilities["reward:redeem"];
			// Paying from the pot is a withdrawal: the household policy decides.
			if (fundedFrom === "shared" && !canWithdrawFromPot(actor)) return false;
			return assigneeIds.length === 0 || assigneeIds.includes(actor.userId);
		}
		case "pot:withdraw":
			return canWithdrawFromPot(actor);
		case "pot:payout":
		case "ledger:adjust":
		case "household:manage":
			return actor.role === "owner";
	}
	return false;
}
