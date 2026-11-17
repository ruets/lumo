// SPDX-License-Identifier: AGPL-3.0-or-later
import { hash, verify } from "@node-rs/argon2";

// Argon2id (default algorithm of @node-rs/argon2), OWASP parameters: 19 MiB, 2 passes.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
	return hash(password, OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. If the account does not exist (`storedHash` null), we still verify
 * against a dummy hash so response time does not reveal whether the username exists.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
	if (!storedHash) {
		dummyHash ??= hashPassword("lumo-dummy-password");
		await verify(await dummyHash, password).catch(() => false);
		return false;
	}
	return verify(storedHash, password).catch(() => false);
}
