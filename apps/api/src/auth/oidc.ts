// SPDX-License-Identifier: AGPL-3.0-or-later
import * as client from "openid-client";

export interface OidcClaims {
	sub: string;
	name: string | null;
	email: string | null;
	picture: string | null;
	groups: string[];
}

/** Abstraction of the OIDC provider (Authentik): allows a fake provider in tests. */
export interface OidcProvider {
	buildAuthorizationUrl(params: {
		redirectUri: string;
		state: string;
		nonce: string;
		codeChallenge: string;
	}): Promise<string>;
	/** `expectedState: null`: the client (mobile) has already checked the state on its side. */
	exchange(params: {
		callbackUrl: URL;
		codeVerifier: string;
		expectedState: string | null;
		expectedNonce: string;
	}): Promise<OidcClaims>;
}

export function createOidcProvider(opts: { issuer: string; clientId: string; clientSecret: string }): OidcProvider {
	let configPromise: Promise<client.Configuration> | undefined;
	const getConfig = () => {
		configPromise ??= client.discovery(new URL(opts.issuer), opts.clientId, opts.clientSecret).catch((err) => {
			configPromise = undefined; // retry on the next call (Authentik may start after Lumo)
			throw err;
		});
		return configPromise;
	};

	return {
		async buildAuthorizationUrl({ redirectUri, state, nonce, codeChallenge }) {
			const config = await getConfig();
			return client.buildAuthorizationUrl(config, {
				redirect_uri: redirectUri,
				scope: "openid profile email",
				state,
				nonce,
				code_challenge: codeChallenge,
				code_challenge_method: "S256",
			}).href;
		},
		async exchange({ callbackUrl, codeVerifier, expectedState, expectedNonce }) {
			const config = await getConfig();
			const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
				pkceCodeVerifier: codeVerifier,
				expectedState: expectedState ?? client.skipStateCheck,
				expectedNonce,
				idTokenExpected: true,
			});
			const claims = tokens.claims();
			if (!claims) throw new Error("ID token absent");
			const groups = Array.isArray(claims.groups)
				? claims.groups.filter((g): g is string => typeof g === "string")
				: [];
			return {
				sub: claims.sub,
				name: typeof claims.name === "string" ? claims.name : null,
				email: typeof claims.email === "string" ? claims.email.toLowerCase() : null,
				picture: typeof claims.picture === "string" ? claims.picture : null,
				groups,
			};
		},
	};
}

export const pkce = {
	codeVerifier: client.randomPKCECodeVerifier,
	codeChallenge: client.calculatePKCECodeChallenge,
	state: client.randomState,
	nonce: client.randomNonce,
};
