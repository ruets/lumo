// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The OIDC redirect (`lumo:///auth?code=…`) is also delivered to the router, which would show "Unmatched Route".
 * `expo-auth-session` completes the sign-in on its own, so the router just goes to the app's root.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
	return /^(?:[a-z][a-z0-9+.-]*:)?\/*auth(?:[/?#]|$)/i.test(path) ? "/" : path;
}
