// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Role } from "./roles.js";

export interface Actor {
	userId: string;
	role: Role;
	/** Can a child create their own items? */
	canCreateItems: boolean;
}

/** Each action and the resource its decision depends on. */
export interface Abilities {
	"item:create": { assigneeIds: readonly string[] };
	"item:update": { createdBy: string };
	"completion:create": { userId: string };
	"completion:undo": { userId: string; userRole: Role };
	"completion:approve": { userId: string };
	"completion:review": undefined;
	"completion:backdate": { daysAgo: number; windowDays: number };
	"reward:manage": undefined;
	"redemption:undo": { userId: string; userRole: Role };
	"reward:redeem": { fundedFrom: "personal" | "shared"; assigneeIds: readonly string[] };
	"transfer:create": undefined;
	"ledger:adjust": undefined;
	"household:manage": undefined;
}

export type Action = keyof Abilities;

const isAdult = (a: Actor) => a.role === "owner" || a.role === "adult";

/** Rights matrix (docs/ARCHITECTURE.md). Checked on the server, never on the client alone. */
export function can<A extends Action>(
	actor: Actor,
	action: A,
	...[resource]: Abilities[A] extends undefined ? [] : [Abilities[A]]
): boolean {
	const r = resource as Abilities[Action];
	switch (action) {
		case "item:create": {
			const { assigneeIds } = r as Abilities["item:create"];
			if (isAdult(actor)) return true;
			return actor.canCreateItems && assigneeIds.every((id) => id === actor.userId);
		}
		case "item:update":
			if (isAdult(actor)) return true;
			return actor.canCreateItems && (r as Abilities["item:update"]).createdBy === actor.userId;
		case "completion:create":
			return (r as Abilities["completion:create"]).userId === actor.userId;
		case "completion:undo":
		case "redemption:undo": {
			const { userId, userRole } = r as Abilities["completion:undo"] | Abilities["redemption:undo"];
			if (userId === actor.userId) return true;
			if (actor.role === "owner") return true;
			return actor.role === "adult" && userRole === "child";
		}
		case "completion:approve":
			return isAdult(actor) && (r as Abilities["completion:approve"]).userId !== actor.userId;
		case "completion:backdate": {
			const { daysAgo, windowDays } = r as Abilities["completion:backdate"];
			return daysAgo <= windowDays || actor.role === "owner";
		}
		case "completion:review":
		case "reward:manage":
			return isAdult(actor);
		case "reward:redeem": {
			const { fundedFrom, assigneeIds } = r as Abilities["reward:redeem"];
			if (fundedFrom === "shared" && !isAdult(actor)) return false;
			return assigneeIds.length === 0 || assigneeIds.includes(actor.userId);
		}
		case "transfer:create":
			return true;
		case "ledger:adjust":
		case "household:manage":
			return actor.role === "owner";
	}
	return false;
}
