// SPDX-License-Identifier: AGPL-3.0-or-later

export const ROLES = ["owner", "adult", "child"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { child: 0, adult: 1, owner: 2 };

export function isRole(value: unknown): value is Role {
	return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Renvoie le rôle le plus élevé des deux. */
export function highestRole(a: Role, b: Role): Role {
	return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Rôle d'un membre à la connexion OIDC : l'appartenance au groupe d'administration
 * (ex. `lumo-admins`) promeut en `owner` ; elle ne rétrograde jamais.
 */
export function roleAfterOidcLogin(current: Role, groups: readonly string[], adminGroup: string | null): Role {
	if (adminGroup && groups.includes(adminGroup)) return "owner";
	return current;
}
