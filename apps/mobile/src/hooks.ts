// SPDX-License-Identifier: AGPL-3.0-or-later
import { ApiError, type TodayResponse } from "@lumo/api-client";
import { addDays } from "@lumo/domain";
import { errorMessage } from "@lumo/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { type QueuedCompletion, useQueue } from "./queue";
import { api } from "./session";
import { showToast } from "./store";

export const keys = {
	authConfig: ["auth-config"] as const,
	me: ["me"] as const,
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

/** `null` = not signed in (401). */
export const useMe = (enabled = true) =>
	useQuery({
		enabled,
		queryKey: keys.me,
		queryFn: async () => {
			try {
				return await api.getMe();
			} catch (err) {
				if (err instanceof ApiError && err.status === 401) return null;
				throw err;
			}
		},
		staleTime: 30_000,
	});

/** The server's day + completions in the offline queue (applied on top, for instant feedback). */
export function useToday(date?: string) {
	const q = useQuery({ queryKey: keys.today(date), queryFn: () => api.getToday(date) });
	const queue = useQueue();
	const data = useMemo(() => (q.data ? overlayQueue(q.data, queue) : undefined), [q.data, queue]);
	return { ...q, data };
}

export function overlayQueue(today: TodayResponse, queue: QueuedCompletion[]): TodayResponse {
	const mine = queue.filter((o) => o.date === today.date);
	if (mine.length === 0) return today;
	return {
		...today,
		items: today.items.map((e) => {
			const n = mine.filter((o) => o.itemId === e.item.id).length;
			if (n === 0) return e;
			const room = Math.max(0, e.target - e.approved - e.pending);
			const added = Math.min(n, room);
			const approved = e.approved + (e.item.requiresApproval ? 0 : added);
			return {
				...e,
				approved,
				pending: e.pending + (e.item.requiresApproval ? added : 0),
				done: approved >= e.target,
			};
		}),
	};
}

/** Displayed balance: server + rewards of the completions still queued. */
export function useBalance(serverBalance: number): number {
	const queue = useQueue();
	const today = useQuery({ queryKey: keys.today(), queryFn: () => api.getToday() });
	const pendingGain = (today.data?.items ?? []).reduce((sum, e) => {
		if (e.item.requiresApproval || e.item.creditsTo !== "personal") return sum;
		const n = queue.filter((o) => o.itemId === e.item.id && o.date === today.data?.date).length;
		return sum + e.item.reward * Math.min(n, Math.max(0, e.target - e.approved - e.pending));
	}, 0);
	return serverBalance + pendingGain;
}

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

function useWrite<V, R>(fn: (v: V) => Promise<R>) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onError: (err) => showToast(describeError(err)),
		onSettled: () => void qc.invalidateQueries(),
	});
}

/** Undo a completion that was sent (needs the network). */
export const useUndo = () => useWrite((completionId: string) => api.undoCompletion(completionId));
export const useUndoRedemption = () => useWrite((redemptionId: string) => api.undoRedemption(redemptionId));
export const useRedeem = () => useWrite((rewardId: string) => api.redeemReward(rewardId));
export const useReview = () =>
	useWrite(({ id, approve }: { id: string; approve: boolean }) =>
		approve ? api.approveCompletion(id) : api.rejectCompletion(id),
	);

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
