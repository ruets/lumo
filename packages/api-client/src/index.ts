// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Client HTTP de l'API Lumo. Les types des routes métier sont générés depuis la spec OpenAPI
 * (`pnpm --filter @lumo/api-client generate` après `pnpm --filter @lumo/api openapi:generate`) ;
 * les routes d'authentification, hors spec, sont typées à la main.
 * Aucune méthode n'accepte de montant : le serveur calcule les pièces.
 */

import type { paths } from "./generated/schema.js";

export type { paths };

type JsonOf<T> = T extends { content: { "application/json": infer J } } ? J : never;
type Response<P extends keyof paths, M extends keyof paths[P], S extends number> = paths[P][M] extends {
	responses: infer R;
}
	? S extends keyof R
		? JsonOf<R[S]>
		: never
	: never;
type BodyOf<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
	requestBody: { content: { "application/json": infer B } };
}
	? B
	: never;
type QueryOf<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends { parameters: { query?: infer Q } }
	? NonNullable<Q>
	: never;

export type Role = "owner" | "adult" | "child";
export type MeResponse = Response<"/api/v1/me", "get", 200>;
export type Item = Response<"/api/v1/items", "post", 201>;
export type CreateItemInput = BodyOf<"/api/v1/items", "post">;
export type UpdateItemInput = BodyOf<"/api/v1/items/{id}", "patch">;
export type TodayResponse = Response<"/api/v1/today", "get", 200>;
export type TodayItem = TodayResponse["items"][number];
export type RewardList = Response<"/api/v1/rewards", "get", 200>["rewards"];
export type LedgerEntry = LedgerPage["entries"][number];
export type CompletionResult = Response<"/api/v1/items/{id}/completions", "post", 201>;
export type Reward = Response<"/api/v1/rewards", "post", 201>;
export type CreateRewardInput = BodyOf<"/api/v1/rewards", "post">;
export type UpdateRewardInput = BodyOf<"/api/v1/rewards/{id}", "patch">;
export type LedgerPage = Response<"/api/v1/ledger", "get", 200>;
export type StatsResponse = Response<"/api/v1/stats", "get", 200>;

export interface AuthConfig {
	/** Marqueur d'identification : prouve qu'une adresse est un serveur Lumo. */
	app: "lumo";
	oidc: boolean;
	oidcIssuer: string | null;
	oidcClientId: string | null;
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

/** `idempotencyKey` : fixé par l'appelant pour rejouer une écriture sans la dupliquer (file hors ligne). */
export interface RequestOptions {
	idempotencyKey?: string;
}

export interface ClientOptions {
	/** Générateur de clés d'idempotence. Hermes (React Native) n'a pas `crypto.randomUUID` : l'appli fournit le sien. */
	generateKey?: () => string;
	/** Une fonction permet de changer de serveur à chaud (appli mobile). */
	baseUrl: string | (() => string);
	/** Jeton d'accès (mobile). Absent côté web : le cookie de session suffit. */
	getAccessToken?: () => string | null | Promise<string | null>;
	fetch?: typeof fetch;
}

export function createClient(options: ClientOptions) {
	const doFetch = options.fetch ?? fetch;
	const newKey = options.generateKey ?? (() => globalThis.crypto.randomUUID());

	async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
		const headers: Record<string, string> = { accept: "application/json" };
		const token = await options.getAccessToken?.();
		if (token) headers.authorization = `Bearer ${token}`;
		if (body !== undefined) headers["content-type"] = "application/json";
		if (method !== "GET") headers["idempotency-key"] = opts.idempotencyKey ?? newKey();

		const base = typeof options.baseUrl === "function" ? options.baseUrl() : options.baseUrl;
		const res = await doFetch(`${base}/api/v1${path}`, {
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

	const qs = (q: object | undefined) => {
		const entries = Object.entries(q ?? {}).filter(([, v]) => v !== undefined);
		return entries.length
			? `?${new URLSearchParams(entries.map(([k, v]): [string, string] => [k, String(v)])).toString()}`
			: "";
	};

	return {
		// --- Éléments et validations
		getToday: (date?: string) => request<TodayResponse>("GET", `/today${qs({ date })}`),
		listItems: (includeArchived = false) =>
			request<Response<"/api/v1/items", "get", 200>>("GET", `/items${qs({ includeArchived })}`),
		createItem: (input: CreateItemInput) => request<Item>("POST", "/items", input),
		updateItem: (id: string, input: UpdateItemInput) => request<Item>("PATCH", `/items/${id}`, input),
		archiveItem: (id: string) => request<void>("DELETE", `/items/${id}`),
		complete: (itemId: string, date?: string, opts?: RequestOptions) =>
			request<CompletionResult>("POST", `/items/${itemId}/completions`, date ? { date } : {}, opts),
		undoCompletion: (id: string, opts?: RequestOptions) =>
			request<CompletionResult>("DELETE", `/completions/${id}`, undefined, opts),
		approveCompletion: (id: string) => request<CompletionResult>("POST", `/completions/${id}/approve`),
		rejectCompletion: (id: string) => request<CompletionResult>("POST", `/completions/${id}/reject`),
		listPendingCompletions: () =>
			request<Response<"/api/v1/completions", "get", 200>>("GET", "/completions?status=pending"),
		// --- Envies, pièces, progrès
		listRewards: () => request<Response<"/api/v1/rewards", "get", 200>>("GET", "/rewards"),
		createReward: (input: CreateRewardInput) => request<Reward>("POST", "/rewards", input),
		updateReward: (id: string, input: UpdateRewardInput) => request<Reward>("PATCH", `/rewards/${id}`, input),
		redeemReward: (id: string, opts?: RequestOptions) =>
			request<Response<"/api/v1/rewards/{id}/redemptions", "post", 201>>(
				"POST",
				`/rewards/${id}/redemptions`,
				undefined,
				opts,
			),
		undoRedemption: (id: string, opts?: RequestOptions) =>
			request<Response<"/api/v1/redemptions/{id}", "delete", 200>>("DELETE", `/redemptions/${id}`, undefined, opts),
		transferToShared: (amount: number) =>
			request<Response<"/api/v1/transfers", "post", 201>>("POST", "/transfers", { amount }),
		getLedger: (query: QueryOf<"/api/v1/ledger", "get"> = {}) => request<LedgerPage>("GET", `/ledger${qs(query)}`),
		adjustCoins: (input: BodyOf<"/api/v1/ledger/adjustments", "post">) =>
			request<Response<"/api/v1/ledger/adjustments", "post", 201>>("POST", "/ledger/adjustments", input),
		getStats: (query: QueryOf<"/api/v1/stats", "get"> = {}) => request<StatsResponse>("GET", `/stats${qs(query)}`),
		// --- Authentification
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
