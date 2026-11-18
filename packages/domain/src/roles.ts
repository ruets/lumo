// SPDX-License-Identifier: AGPL-3.0-or-later

/** A household has owners, who manage it, and members. Supervision (guardians) is a property of the account. */
export const ROLES = ["owner", "member"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { member: 0, owner: 1 };

export function isRole(value: unknown): value is Role {
	return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Returns the higher of the two roles. */
export function highestRole(a: Role, b: Role): Role {
	return RANK[a] >= RANK[b] ? a : b;
}
