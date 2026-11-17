// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Role } from "./roles.js";
import { DomainError } from "./rules.js";

/**
 * A household always keeps at least one owner: demoting the last one would lock everybody out of
 * member management. Changing someone who is not an owner, or keeping the same role, is always allowed.
 * `ownerCount` is the number of owners before the change.
 */
export function assertRoleChange(input: { currentRole: Role; newRole: Role; ownerCount: number }): void {
	if (input.currentRole === "owner" && input.newRole !== "owner" && input.ownerCount <= 1) {
		throw new DomainError("last_owner", "A household needs at least one owner");
	}
}
