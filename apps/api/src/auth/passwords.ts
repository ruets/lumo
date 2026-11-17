// SPDX-License-Identifier: AGPL-3.0-or-later
import { hash, verify } from "@node-rs/argon2";

// Argon2id (algorithme par défaut de @node-rs/argon2), paramètres OWASP : 19 Mio, 2 passes.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
	return hash(password, OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Vérifie un mot de passe. Si le compte n'existe pas (`storedHash` null), on vérifie quand
 * même contre un hash factice pour ne pas révéler l'existence de l'identifiant par le temps de réponse.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
	if (!storedHash) {
		dummyHash ??= hashPassword("lumo-dummy-password");
		await verify(await dummyHash, password).catch(() => false);
		return false;
	}
	return verify(storedHash, password).catch(() => false);
}
