// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import {
	adjustmentBody,
	balancesView,
	createRewardBody,
	idParams,
	ledgerEntryView,
	ledgerQuery,
	redemptionResult,
	rewardView,
	statsQuery,
	statsView,
	transferBody,
	updateRewardBody,
} from "../schemas.js";
import { getStats } from "../services/progress.js";
import { createReward, listRewards, redeemReward, undoRedemption, updateReward } from "../services/rewards.js";
import { adjust, listLedger, transferToShared } from "../services/wallet.js";
import { route } from "./define.js";

export const rewardRoutes = [
	route({
		scope: "account",
		method: "get",
		url: "/rewards",
		summary: "List the wishes",
		tag: "Envies",
		response: z.object({ rewards: z.array(rewardView) }),
		handler: ({ db, actor, now }) => ({ rewards: listRewards(db, actor, now) }),
	}),
	route({
		scope: "account",
		method: "post",
		url: "/rewards",
		summary: "Create a wish (owner and adults)",
		tag: "Envies",
		body: createRewardBody,
		response: rewardView,
		status: 201,
		handler: ({ db, actor, body, now }) => createReward(db, actor, body, now),
	}),
	route({
		scope: "account",
		method: "patch",
		url: "/rewards/:id",
		summary: "Update or archive a wish",
		tag: "Envies",
		params: idParams,
		body: updateRewardBody,
		response: rewardView,
		handler: ({ db, actor, params, body, now }) => updateReward(db, actor, params.id, body, now),
	}),
	route({
		scope: "account",
		method: "post",
		url: "/rewards/:id/redemptions",
		summary: "Redeem a wish for coins",
		tag: "Envies",
		params: idParams,
		response: redemptionResult,
		status: 201,
		handler: ({ db, actor, params, now }) => redeemReward(db, actor, params.id, now),
	}),
	route({
		scope: "account",
		method: "delete",
		url: "/redemptions/:id",
		summary: "Undo a wish redemption (refund by counter-entry)",
		tag: "Envies",
		params: idParams,
		response: redemptionResult,
		handler: ({ db, actor, params, now }) => undoRedemption(db, actor, params.id, now),
	}),
];

export const walletRoutes = [
	route({
		method: "post",
		url: "/transfers",
		summary: "Transfer coins from your wallet to the shared pot",
		tag: "Coins",
		body: transferBody,
		response: z.object({ transferId: z.string(), balances: balancesView }),
		status: 201,
		handler: ({ db, actor, body, now }) => transferToShared(db, actor, body.amount, now),
	}),
	route({
		scope: "account",
		method: "get",
		url: "/ledger",
		summary: "A wallet's history, cursor-paginated",
		tag: "Coins",
		query: ledgerQuery,
		response: z.object({
			wallet: z.enum(["personal", "shared"]),
			walletId: z.string(),
			balance: z.number().int(),
			entries: z.array(ledgerEntryView),
			nextCursor: z.string().nullable(),
		}),
		handler: ({ db, actor, query }) => listLedger(db, actor, query),
	}),
	route({
		method: "post",
		url: "/ledger/adjustments",
		summary: "Manual coin adjustment (owner)",
		tag: "Coins",
		body: adjustmentBody,
		response: z.object({ entry: ledgerEntryView }),
		status: 201,
		handler: ({ db, actor, body, now }) => adjust(db, actor, body, now),
	}),
	route({
		scope: "account",
		method: "get",
		url: "/stats",
		summary: "Streaks, success rates and heatmap",
		tag: "Progress",
		query: statsQuery,
		response: statsView,
		handler: ({ db, actor, query, now }) => getStats(db, actor, query, now),
	}),
];
