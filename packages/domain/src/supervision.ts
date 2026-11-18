// SPDX-License-Identifier: AGPL-3.0-or-later
import { DomainError } from "./rules.js";

/**
 * What the guardians of a supervised account allow it to do by itself. Having at least one guardian is what makes
 * an account supervised; an unsupervised account is not limited by these rights.
 */
export interface WardRights {
	canCreate: boolean;
	canModify: boolean;
	canDelete: boolean;
	canTransfer: boolean;
}

export type WardAction = "create" | "modify" | "delete" | "transfer";

/** New supervision starts strict: a ward may not mint coins, change or delete things until a guardian lets it. */
export const DEFAULT_WARD_RIGHTS: WardRights = {
	canCreate: false,
	canModify: false,
	canDelete: false,
	canTransfer: true,
};

/** `null` = unsupervised account: nothing is withheld. */
export function supervisionAllows(rights: WardRights | null, action: WardAction): boolean {
	if (rights === null) return true;
	switch (action) {
		case "create":
			return rights.canCreate;
		case "modify":
			return rights.canModify;
		case "delete":
			return rights.canDelete;
		case "transfer":
			return rights.canTransfer;
	}
}

/**
 * Guards for starting a supervision: never yourself, never twice, and no loops: a supervised account cannot
 * supervise others, and two accounts cannot supervise each other.
 */
export function assertCanSupervise(input: {
	guardianId: string;
	wardId: string;
	alreadySupervising: boolean;
	guardianIsSupervised: boolean;
	wardSupervisesGuardian: boolean;
}): void {
	if (input.guardianId === input.wardId) {
		throw new DomainError("cannot_target_self", "You cannot supervise yourself");
	}
	if (input.alreadySupervising)
		throw new DomainError("already_supervising", "This account is already supervised by you");
	if (input.guardianIsSupervised || input.wardSupervisesGuardian) {
		throw new DomainError("guardian_cycle", "A supervised account cannot supervise others");
	}
}
