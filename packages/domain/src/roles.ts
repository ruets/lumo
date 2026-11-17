// SPDX-License-Identifier: AGPL-3.0-or-later

export const ROLES = ["owner", "adult", "child"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { child: 0, adult: 1, owner: 2 };

export function isRole(value: unknown): value is Role {
	return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Returns the higher of the two roles. */
export function highestRole(a: Role, b: Role): Role {
	return RANK[a] >= RANK[b] ? a : b;
}
