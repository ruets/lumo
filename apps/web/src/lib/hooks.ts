// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError, type MeResponse, type TodayResponse } from "@lumo/api-client";
import { addDays } from "@lumo/domain";
import { errorMessage } from "@lumo/i18n";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { showToast } from "./toast";

export const keys = {
	authConfig: ["auth-config"] as const,
	me: ["me"] as const,
	account: ["account"] as const,
	adminUsers: ["admin", "users"] as const,
	adminHouseholds: ["admin", "households"] as const,
	adminSettings: ["admin", "settings"] as const,
	today: (date?: string) => ["today", date ?? "now"] as const,
	items: ["items"] as const,
	rewards: ["rewards"] as const,
	stats: (from: string, to: string) => ["stats", from, to] as const,
	ledger: ["ledger"] as const,
	pending: ["pending"] as const,
	household: ["household"] as const,
};

export function describeError(err: unknown): string {
	return err instanceof ApiError ? errorMessage(err.code, err.message) : errorMessage("unknown");
}

export const useAuthConfig = () => useQuery({ queryKey: keys.authConfig, queryFn: () => api.getAuthConfig() });

/** The signed-in account, with or without a household. `null` = not signed in (401). */
export const useAccount = () =>
	useQuery({
		queryKey: keys.account,
		queryFn: async () => {
			try {
				return await api.getAccount();
			} catch (err) {
				if (err instanceof ApiError && err.status === 401) return null;
				throw err;
			}
		},
		staleTime: 30_000,
	});

/** Profile inside the household. `null` = not signed in, or not (any more) in a household. */
export const useMe = (enabled = true) =>
	useQuery({
		queryKey: keys.me,
		queryFn: async () => {
			try {
				return await api.getMe();
			} catch (err) {
				if (err instanceof ApiError && (err.status === 401 || err.code === "no_household")) return null;
				throw err;
			}
		},
		staleTime: 30_000,
		enabled,
	});

export const useToday = (date?: string) => useQuery({ queryKey: keys.today(date), queryFn: () => api.getToday(date) });

export const useRewards = () => useQuery({ queryKey: keys.rewards, queryFn: () => api.listRewards() });

export const useItems = (enabled = true) => useQuery({ queryKey: keys.items, queryFn: () => api.listItems(), enabled });

export const useStats = (from: string | undefined, to: string | undefined) =>
	useQuery({
		queryKey: keys.stats(from ?? "", to ?? ""),
		queryFn: () => api.getStats({ from, to }),
		enabled: Boolean(from && to),
	});

export const useLedger = () => useQuery({ queryKey: keys.ledger, queryFn: () => api.getLedger({ limit: 100 }) });

export const usePending = (enabled: boolean) =>
	useQuery({ queryKey: keys.pending, queryFn: () => api.listPendingCompletions(), enabled });

/** 56-day window for the Progress screen (current and previous period). */
export const statsWindow = (today: string) => ({ from: addDays(today, -55), to: today });

function patchToday(qc: QueryClient, date: string | undefined, fn: (t: TodayResponse) => TodayResponse) {
	qc.setQueryData<TodayResponse>(keys.today(date), (t) => (t ? fn(t) : t));
}

function patchBalance(qc: QueryClient, delta: number) {
	qc.setQueryData<MeResponse | null>(keys.me, (me) =>
		me
			? {
					...me,
					wallets: {
						...me.wallets,
						personal: { ...me.wallets.personal, balance: me.wallets.personal.balance + delta },
					},
				}
			: me,
	);
}

function invalidateAfterWrite(qc: QueryClient) {
	for (const k of ["today", "stats", "ledger", "me", "pending", "rewards"])
		void qc.invalidateQueries({ queryKey: [k] });
}

/** Complete: optimistic update, rolled back if the server refuses. No `date` = today. */
export function useComplete(date?: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (itemId: string) => api.complete(itemId, date),
		onMutate: async (itemId) => {
			await qc.cancelQueries({ queryKey: keys.today(date) });
			const before = qc.getQueryData<TodayResponse>(keys.today(date));
			const entry = before?.items.find((i) => i.item.id === itemId);
			patchToday(qc, date, (t) => ({
				...t,
				items: t.items.map((i) => {
					if (i.item.id !== itemId) return i;
					const pending = i.item.requiresApproval;
					const approved = i.approved + (pending ? 0 : 1);
					return { ...i, approved, pending: i.pending + (pending ? 1 : 0), done: approved >= i.target };
				}),
			}));
			if (entry && !entry.item.requiresApproval && entry.item.creditsTo === "personal")
				patchBalance(qc, entry.item.reward);
			return { before };
		},
		onError: (err, _id, ctx) => {
			if (ctx?.before) qc.setQueryData(keys.today(date), ctx.before);
			showToast(describeError(err));
		},
		onSettled: () => invalidateAfterWrite(qc),
	});
}

/** Undo the item's most recent completion that day. */
export function useUndo() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (completionId: string) => api.undoCompletion(completionId),
		onError: (err) => showToast(describeError(err)),
		onSettled: () => invalidateAfterWrite(qc),
	});
}

export function useRedeem() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (rewardId: string) => api.redeemReward(rewardId),
		onError: (err) => showToast(describeError(err)),
		onSettled: () => invalidateAfterWrite(qc),
	});
}

export function useUndoRedemption() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (redemptionId: string) => api.undoRedemption(redemptionId),
		onError: (err) => showToast(describeError(err)),
		onSettled: () => invalidateAfterWrite(qc),
	});
}

export function useReview() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
			approve ? api.approveCompletion(id) : api.rejectCompletion(id),
		onError: (err) => showToast(describeError(err)),
		onSettled: () => invalidateAfterWrite(qc),
	});
}

/** Signs out: revokes the session on the server (if reachable) and clears every cached query. */
export function useLogout() {
	const qc = useQueryClient();
	return async () => {
		await api.logout().catch(() => undefined);
		qc.clear();
		qc.setQueryData(keys.account, null);
	};
}

export const useHousehold = () => useQuery({ queryKey: keys.household, queryFn: () => api.getHousehold() });

function useHouseholdWrite<V, R>(fn: (v: V) => Promise<R>) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onError: (err) => showToast(describeError(err)),
		onSettled: () => void qc.invalidateQueries({ queryKey: keys.household }),
	});
}

export const useUpdateMember = () =>
	useHouseholdWrite(({ id, input }: { id: string; input: Parameters<typeof api.updateMember>[1] }) =>
		api.updateMember(id, input),
	);
export const useCreateInvite = () => useHouseholdWrite((role: "adult" | "child") => api.createInvite(role));
export const useRevokeInvite = () => useHouseholdWrite((id: string) => api.revokeInvite(id));
export const useRemoveMember = () => useHouseholdWrite((id: string) => api.removeMember(id));

/** Household settings also feed `/me` (household name) and every date computation: refresh everything. */
export function useUpdateHousehold() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: Parameters<typeof api.updateHousehold>[0]) => api.updateHousehold(input),
		onError: (err) => showToast(describeError(err)),
		onSettled: () => void qc.invalidateQueries(),
	});
}

/** Changes who is in which household: everything the app shows may change. */
function useEverythingWrite<V, R>(fn: (v: V) => Promise<R>) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onError: (err) => showToast(describeError(err)),
		onSettled: () => void qc.invalidateQueries(),
	});
}

export const useLeaveHousehold = () => useEverythingWrite(() => api.leaveHousehold());
export const useJoinHousehold = () => useEverythingWrite((code: string) => api.joinHousehold(code));
export const useCreateOwnHousehold = () => useEverythingWrite((name: string) => api.createHousehold(name));

export const useAdminUsers = () => useQuery({ queryKey: keys.adminUsers, queryFn: () => api.adminListUsers() });
export const useAdminHouseholds = () =>
	useQuery({ queryKey: keys.adminHouseholds, queryFn: () => api.adminListHouseholds() });
export const useAdminSettings = () => useQuery({ queryKey: keys.adminSettings, queryFn: () => api.adminGetSettings() });

/** Admin writes refresh the admin lists and the caller's own account (they may have changed themselves). */
export function useAdminWrite<V, R>(fn: (v: V) => Promise<R>) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onError: (err) => showToast(describeError(err)),
		onSettled: () => void qc.invalidateQueries(),
	});
}
