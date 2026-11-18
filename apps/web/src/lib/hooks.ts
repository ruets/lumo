// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError, type MeResponse, type TodayResponse } from "@lumo/api-client";
import { addDays } from "@lumo/domain";
import { errorMessage } from "@lumo/i18n";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { setActiveHouseholdId } from "./household";
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

/** Everything waiting for the approval of this person as a guardian (empty when they supervise nobody). */
export const usePending = () => useQuery({ queryKey: keys.pending, queryFn: () => api.getGuardianPending() });

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
		mutationFn: ({ wardId, id, approve }: { wardId: string; id: string; approve: boolean }) =>
			api.reviewWardCompletion(wardId, id, approve),
		onError: (err) => showToast(describeError(err)),
		onSettled: () => invalidateAfterWrite(qc),
	});
}

/** Signs out: revokes the session on the server (if reachable) and clears every cached query. */
export function useLogout() {
	const qc = useQueryClient();
	return async () => {
		await api.logout().catch(() => undefined);
		setActiveHouseholdId(null);
		// `qc.clear()` would detach the observer the root screen is watching, which then never hears that the
		// account is gone. Say "signed out" on the existing query first, then drop everything else.
		qc.setQueryData(keys.account, null);
		qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.account[0] });
	};
}

export const useHousehold = (enabled = true) =>
	useQuery({ queryKey: keys.household, queryFn: () => api.getHousehold(), enabled });

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
/** Coins move between wallets: refresh everything that shows a balance. */
export function usePotWrite<V, R>(fn: (v: V) => Promise<R>) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onError: (err) => showToast(describeError(err)),
		onSettled: () => void qc.invalidateQueries(),
	});
}

export const useCreateInvite = () => useHouseholdWrite((role: "owner" | "member") => api.createInvite(role));
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
/** Joining or creating a household makes it the active one. */
export const useJoinHousehold = () =>
	useEverythingWrite(async (code: string) => {
		const r = await api.joinHousehold(code);
		setActiveHouseholdId(r.householdId);
		return r;
	});
export const useCreateOwnHousehold = () =>
	useEverythingWrite(async (name: string) => {
		const r = await api.createHousehold(name);
		setActiveHouseholdId(r.householdId);
		return r;
	});

export function useUpdateAccount() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: Parameters<typeof api.updateAccount>[0]) => api.updateAccount(input),
		onError: (err) => showToast(describeError(err)),
		onSettled: () => void qc.invalidateQueries(),
	});
}

/** Switches the active household and refetches everything that depends on it. */
export function useSwitchHousehold() {
	const qc = useQueryClient();
	return (id: string) => {
		setActiveHouseholdId(id);
		void qc.invalidateQueries();
	};
}

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

export const useSupervision = () => useQuery({ queryKey: ["supervision"], queryFn: () => api.getSupervision() });
export const useWardMe = (id: string) =>
	useQuery({ queryKey: ["supervision", id, "me"], queryFn: () => api.getWardMe(id) });
export const useWardItems = (id: string) =>
	useQuery({ queryKey: ["supervision", id, "items"], queryFn: () => api.listWardItems(id) });
export const useWardRewards = (id: string) =>
	useQuery({ queryKey: ["supervision", id, "rewards"], queryFn: () => api.listWardRewards(id) });
export const useWardPending = (id: string) =>
	useQuery({ queryKey: ["supervision", id, "pending"], queryFn: () => api.getWardPending(id) });

/** Supervision writes can change what the person sees everywhere: refetch everything. */
export function useSupervisionWrite<V, R>(fn: (v: V) => Promise<R>) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onError: (err) => showToast(describeError(err)),
		onSettled: () => void qc.invalidateQueries(),
	});
}
