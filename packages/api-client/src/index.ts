// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * HTTP client of the Lumo API. The types of the business routes are generated from the OpenAPI spec
 * (`pnpm --filter @lumo/api-client generate` after `pnpm --filter @lumo/api openapi:generate`);
 * the authentication routes, outside the spec, are typed by hand.
 * No method accepts an amount: the server computes the coins.
 */

import type { paths } from "./generated/schema.js";

export * from "./spaces.js";
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

export type Role = "owner" | "member";
export type MeResponse = Response<"/api/v1/me", "get", 200>;
export type HouseholdResponse = Response<"/api/v1/household", "get", 200>;
export type Member = HouseholdResponse["members"][number];
export type PendingInvite = HouseholdResponse["invites"][number];
export type UpdateHouseholdInput = BodyOf<"/api/v1/household", "patch">;
export type UpdateMemberInput = BodyOf<"/api/v1/members/{id}", "patch">;
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

export type AccountResponse = Response<"/api/v1/account", "get", 200>;
export type AdminUser = Response<"/api/v1/admin/users", "get", 200>["users"][number];
export type AdminHousehold = Response<"/api/v1/admin/households", "get", 200>["households"][number];
export type SupervisionResponse = Response<"/api/v1/supervision", "get", 200>;
export type Ward = SupervisionResponse["wards"][number];
export type WardRights = Ward["rights"];
export type WardPending = Response<"/api/v1/supervision/wards/{wardId}/pending", "get", 200>["completions"];
export type UpdateAccountInput = BodyOf<"/api/v1/account", "patch">;
export type InstanceSettings = Response<"/api/v1/admin/settings", "get", 200>;
export type UpdateInstanceSettingsInput = BodyOf<"/api/v1/admin/settings", "patch">;
export type UpdateAdminUserInput = BodyOf<"/api/v1/admin/users/{id}", "patch">;

export interface AuthConfig {
	/** Identification marker: proves an address is a Lumo server. */
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

/** `idempotencyKey`: fixed by the caller to replay a write without duplicating it (offline queue). */
export interface RequestOptions {
	idempotencyKey?: string;
}

export interface ClientOptions {
	/** Idempotency key generator. Hermes (React Native) has no `crypto.randomUUID`: the app provides its own. */
	generateKey?: () => string;
	/** A function allows switching server on the fly (mobile app). */
	baseUrl: string | (() => string);
	/** Access token (mobile). Absent on the web: the session cookie is enough. */
	getAccessToken?: () => string | null | Promise<string | null>;
	/** Active household, sent as `X-Household-Id` (the server falls back to the oldest membership). */
	getHouseholdId?: () => string | null;
	fetch?: typeof fetch;
}

export function createClient(options: ClientOptions) {
	const doFetch = options.fetch ?? fetch;
	const newKey = options.generateKey ?? (() => globalThis.crypto.randomUUID());

	async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
		const headers: Record<string, string> = { accept: "application/json" };
		const token = await options.getAccessToken?.();
		if (token) headers.authorization = `Bearer ${token}`;
		const householdId = options.getHouseholdId?.();
		if (householdId) headers["x-household-id"] = householdId;
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
		// --- Items and completions
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
		// --- Wishes, coins, progress
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
		// --- Household
		getHousehold: () => request<HouseholdResponse>("GET", "/household"),
		updateHousehold: (input: UpdateHouseholdInput) => request<HouseholdResponse>("PATCH", "/household", input),
		removeMember: (id: string) => request<void>("DELETE", `/members/${id}`),
		updateMember: (id: string, input: UpdateMemberInput) => request<Member>("PATCH", `/members/${id}`, input),
		withdrawFromPot: (amount: number) =>
			request<Response<"/api/v1/transfers", "post", 201>>("POST", "/household/pot/withdrawals", { amount }),
		payoutFromPot: (userId: string, amount: number) =>
			request<Response<"/api/v1/transfers", "post", 201>>("POST", "/household/pot/payouts", { userId, amount }),
		createInvite: (role: "owner" | "member") =>
			request<{ token: string; expiresAt: string }>("POST", "/household/invites", { role }),
		revokeInvite: (id: string) => request<void>("DELETE", `/household/invites/${id}`),
		leaveHousehold: () => request<void>("POST", "/household/leave"),
		// --- Account without (or with) a household
		getAccount: () => request<AccountResponse>("GET", "/account"),
		createHousehold: (name: string) => request<{ householdId: string }>("POST", "/households", { name }),
		updateAccount: (input: UpdateAccountInput) => request<AccountResponse>("PATCH", "/account", input),
		joinHousehold: (code: string) => request<{ householdId: string }>("POST", "/household/join", { code }),
		// --- Administration (super admins)
		adminListUsers: () => request<Response<"/api/v1/admin/users", "get", 200>>("GET", "/admin/users"),
		adminCreateAccountInvite: () => request<{ token: string; expiresAt: string }>("POST", "/admin/account-invites", {}),
		adminUpdateUser: (id: string, input: UpdateAdminUserInput) =>
			request<AdminUser>("PATCH", `/admin/users/${id}`, input),
		adminDeleteUser: (id: string) => request<void>("DELETE", `/admin/users/${id}`),
		adminAssignHousehold: (id: string, input: BodyOf<"/api/v1/admin/users/{id}/households", "post">) =>
			request<AdminUser>("POST", `/admin/users/${id}/households`, input),
		adminRemoveFromHousehold: (id: string, householdId: string) =>
			request<void>("DELETE", `/admin/users/${id}/households/${householdId}`),
		adminListHouseholds: () => request<Response<"/api/v1/admin/households", "get", 200>>("GET", "/admin/households"),
		adminCreateHousehold: (name: string) => request<AdminHousehold>("POST", "/admin/households", { name }),
		adminRenameHousehold: (id: string, name: string) =>
			request<AdminHousehold>("PATCH", `/admin/households/${id}`, { name }),
		adminDeleteHousehold: (id: string) => request<void>("DELETE", `/admin/households/${id}`),
		adminAdjustPot: (id: string, input: { amount: number; note: string }) =>
			request<{ balance: number }>("POST", `/admin/households/${id}/pot/adjustments`, input),
		adminGetSettings: () => request<InstanceSettings>("GET", "/admin/settings"),
		adminUpdateSettings: (input: UpdateInstanceSettingsInput) =>
			request<InstanceSettings>("PATCH", "/admin/settings", input),
		// --- Supervision: guardians, wards and the one-time codes between them
		getGuardianPending: () =>
			request<Response<"/api/v1/supervision/pending", "get", 200>>("GET", "/supervision/pending"),
		getSupervision: () => request<SupervisionResponse>("GET", "/supervision"),
		createSupervisionCode: (kind: "supervise" | "be_supervised") =>
			request<{ token: string; expiresAt: string }>("POST", "/supervision/codes", { kind }),
		redeemSupervisionCode: (code: string) => request<SupervisionResponse>("POST", "/supervision/redeem", { code }),
		endSupervision: (wardId: string) => request<void>("DELETE", `/supervision/wards/${wardId}`),
		updateWardRights: (wardId: string, input: Partial<WardRights>) =>
			request<Ward>("PATCH", `/supervision/wards/${wardId}/rights`, input),
		adjustWardCoins: (wardId: string, input: { amount: number; note: string }) =>
			request<{ balance: number }>("POST", `/supervision/wards/${wardId}/adjustments`, input),
		getWardPending: (wardId: string) =>
			request<{ completions: WardPending }>("GET", `/supervision/wards/${wardId}/pending`),
		reviewWardCompletion: (wardId: string, completionId: string, approve: boolean) =>
			request<CompletionResult>(
				"POST",
				`/supervision/wards/${wardId}/completions/${completionId}/${approve ? "approve" : "reject"}`,
			),
		// The ward's own space, through the same rules as the ward's.
		getWardMe: (wardId: string) => request<MeResponse>("GET", `/supervision/wards/${wardId}/me`),
		listWardItems: (wardId: string) =>
			request<Response<"/api/v1/items", "get", 200>>("GET", `/supervision/wards/${wardId}/items`),
		createWardItem: (wardId: string, input: CreateItemInput) =>
			request<Item>("POST", `/supervision/wards/${wardId}/items`, input),
		archiveWardItem: (wardId: string, id: string) =>
			request<void>("DELETE", `/supervision/wards/${wardId}/items/${id}`),
		listWardRewards: (wardId: string) =>
			request<Response<"/api/v1/rewards", "get", 200>>("GET", `/supervision/wards/${wardId}/rewards`),
		createWardReward: (wardId: string, input: CreateRewardInput) =>
			request<Reward>("POST", `/supervision/wards/${wardId}/rewards`, input),
		// --- Authentication
		getAuthConfig: () => request<AuthConfig>("GET", "/auth/config"),
		getMe: () => request<MeResponse>("GET", "/me"),
		setup: (input: {
			householdName: string;
			displayName: string;
			username: string;
			password: string;
			client: "web" | "mobile";
		}) => request<TokenPair | { ok: true }>("POST", "/auth/setup", input),
		registerLocal: (input: {
			invite: string;
			displayName: string;
			username: string;
			password: string;
			client: "web" | "mobile";
		}) => request<TokenPair | { ok: true }>("POST", "/auth/local/register", input),
		loginLocal: (input: { username: string; password: string; client: "web" | "mobile" }) =>
			request<TokenPair | { ok: true }>("POST", "/auth/local/login", input),
		exchangeMobile: (input: {
			code: string;
			codeVerifier: string;
			redirectUri: string;
			nonce: string;
			state?: string;
			/** Invitation code, when the person is joining an existing household. */
			invite?: string;
		}) => request<TokenPair>("POST", "/auth/mobile/exchange", input),
		/** A signed-in account links an Authentik identity to itself (same inputs as `exchangeMobile`). */
		linkOidcMobile: (input: {
			code: string;
			codeVerifier: string;
			redirectUri: string;
			nonce: string;
			state?: string;
		}) => request<void>("POST", "/auth/mobile/link", input),
		refresh: (refreshToken: string) => request<TokenPair>("POST", "/auth/refresh", { refreshToken }),
		logout: (refreshToken?: string) => request<void>("POST", "/auth/logout", refreshToken ? { refreshToken } : {}),
	};
}

export type LumoClient = ReturnType<typeof createClient>;
