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
};

export function describeError(err: unknown): string {
	return err instanceof ApiError ? errorMessage(err.code, err.message) : errorMessage("unknown");
}

export const useAuthConfig = () => useQuery({ queryKey: keys.authConfig, queryFn: () => api.getAuthConfig() });

/** `null` = non connecté (401). */
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

/** Jour du serveur + validations en file hors ligne (appliquées par-dessus, pour un retour immédiat). */
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

/** Solde affiché : serveur + récompenses des validations encore en file. */
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

/** Fenêtre de 56 jours pour l'écran Progrès (période courante et précédente). */
export const statsWindow = (today: string) => ({ from: addDays(today, -55), to: today });

function useWrite<V, R>(fn: (v: V) => Promise<R>) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onError: (err) => showToast(describeError(err)),
		onSettled: () => void qc.invalidateQueries(),
	});
}

/** Annuler une validation envoyée (nécessite le réseau). */
export const useUndo = () => useWrite((completionId: string) => api.undoCompletion(completionId));
export const useRedeem = () => useWrite((rewardId: string) => api.redeemReward(rewardId));
export const useReview = () =>
	useWrite(({ id, approve }: { id: string; approve: boolean }) =>
		approve ? api.approveCompletion(id) : api.rejectCompletion(id),
	);
