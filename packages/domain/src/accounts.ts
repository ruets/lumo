// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Role } from "./roles.js";
import { DomainError } from "./rules.js";

/** Instance-level rights: only super admins manage accounts and households as a whole. */
export const canManageInstance = (account: { isSuperAdmin: boolean }): boolean => account.isSuperAdmin;

/**
 * Super admin status after an OIDC sign-in: members of the configured admin group become super admins; it never
 * demotes. With no admin group configured nobody is promoted from their groups.
 */
export function isSuperAdminAfterOidcLogin(
	current: boolean,
	groups: readonly string[],
	adminGroup: string | null,
): boolean {
	return current || (adminGroup !== null && groups.includes(adminGroup));
}

/**
 * Guards for taking away someone's instance access: nobody disables or deletes themselves, and the instance
 * always keeps at least one super admin (stepping down is fine while another one remains).
 * `superAdminCount` is the number of super admins before the change.
 */
export function assertInstanceAccessChange(input: {
	action: "disable" | "delete" | "demote";
	actorId: string;
	targetId: string;
	targetIsSuperAdmin: boolean;
	superAdminCount: number;
}): void {
	if (input.action !== "demote" && input.actorId === input.targetId) {
		throw new DomainError("cannot_target_self", "You cannot do that to your own account");
	}
	if (input.targetIsSuperAdmin && input.superAdminCount <= 1) {
		throw new DomainError("last_super_admin", "The instance needs at least one super admin");
	}
}

/** Leaving a household is always allowed, except for its last owner. `ownerCount` is the count before leaving. */
export function assertCanLeaveHousehold(input: { role: Role; ownerCount: number }): void {
	if (input.role === "owner" && input.ownerCount <= 1) {
		throw new DomainError("last_owner", "A household needs at least one owner");
	}
}
