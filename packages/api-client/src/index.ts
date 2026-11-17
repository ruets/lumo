// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Client HTTP minimal de l'API Lumo. Sera remplacé par un client généré depuis
 * la spec OpenAPI (étape 2) ; l'interface publique reste la même.
 */

export type Role = "owner" | "adult" | "child";

export interface MeResponse {
	user: { id: string; displayName: string; avatarUrl: string | null };
	household: { id: string; name: string; timezone: string };
	role: Role;
	wallets: { personal: { id: string; balance: number }; shared: { id: string; balance: number } };
}

export interface AuthConfig {
	oidc: boolean;
	local: boolean;
	setupRequired: boolean;
}

export interface TokenPair {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}

export interface Problem {
	type: string;
	title: string;
	status: number;
	code: string;
	detail?: string;
}

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export interface ClientOptions {
	baseUrl: string;
	/** Jeton d'accès (mobile). Absent côté web : le cookie de session suffit. */
	getAccessToken?: () => string | null | Promise<string | null>;
	fetch?: typeof fetch;
}

export function createClient(options: ClientOptions) {
	const doFetch = options.fetch ?? fetch;

	async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const headers: Record<string, string> = { accept: "application/json" };
		const token = await options.getAccessToken?.();
		if (token) headers.authorization = `Bearer ${token}`;
		if (body !== undefined) headers["content-type"] = "application/json";
		if (method !== "GET") headers["idempotency-key"] = crypto.randomUUID();

		const res = await doFetch(`${options.baseUrl}/api/v1${path}`, {
			method,
			headers,
			credentials: "include",
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (res.status === 204) return undefined as T;
		const text = await res.text();
		const data: unknown = text ? JSON.parse(text) : undefined;
		if (!res.ok) {
			const problem = data as Partial<Problem> | undefined;
			throw new ApiError(res.status, problem?.code ?? "unknown", problem?.detail ?? problem?.title ?? res.statusText);
		}
		return data as T;
	}

	return {
		getAuthConfig: () => request<AuthConfig>("GET", "/auth/config"),
		getMe: () => request<MeResponse>("GET", "/me"),
		setup: (input: {
			householdName: string;
			displayName: string;
			username: string;
			password: string;
			client: "web" | "mobile";
		}) => request<TokenPair | { ok: true }>("POST", "/auth/setup", input),
		loginLocal: (input: { username: string; password: string; client: "web" | "mobile" }) =>
			request<TokenPair | { ok: true }>("POST", "/auth/local/login", input),
		exchangeMobile: (input: { code: string; codeVerifier: string; redirectUri: string; nonce: string }) =>
			request<TokenPair>("POST", "/auth/mobile/exchange", input),
		refresh: (refreshToken: string) => request<TokenPair>("POST", "/auth/refresh", { refreshToken }),
		logout: (refreshToken?: string) => request<void>("POST", "/auth/logout", refreshToken ? { refreshToken } : {}),
	};
}

export type LumoClient = ReturnType<typeof createClient>;
