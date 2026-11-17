// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = "lumo";
const AUDIENCE = "lumo-api";

/** Random opaque token (256 bits), base64url. */
export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString("base64url");
}

/** Only the token hash is stored in the database. */
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(secret: string, claims: { userId: string; sessionId: string }) {
	return new SignJWT({ sid: claims.sessionId })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(claims.userId)
		.setIssuer(ISSUER)
		.setAudience(AUDIENCE)
		.setIssuedAt()
		.setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
		.sign(key(secret));
}

export async function verifyAccessToken(
	secret: string,
	token: string,
): Promise<{ userId: string; sessionId: string } | null> {
	try {
		const { payload } = await jwtVerify(token, key(secret), {
			issuer: ISSUER,
			audience: AUDIENCE,
			algorithms: ["HS256"],
		});
		if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
		return { userId: payload.sub, sessionId: payload.sid };
	} catch {
		return null;
	}
}
