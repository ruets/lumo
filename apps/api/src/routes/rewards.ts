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
import { createReward, listRewards, redeemReward, updateReward } from "../services/rewards.js";
import { adjust, listLedger, transferToShared } from "../services/wallet.js";
import { route } from "./define.js";

export const rewardRoutes = [
	route({
		method: "get",
		url: "/rewards",
		summary: "Lister les envies",
		tag: "Envies",
		response: z.object({ rewards: z.array(rewardView) }),
		handler: ({ db, actor, now }) => ({ rewards: listRewards(db, actor, now) }),
	}),
	route({
		method: "post",
		url: "/rewards",
		summary: "Créer une envie (owner et adultes)",
		tag: "Envies",
		body: createRewardBody,
		response: rewardView,
		status: 201,
		handler: ({ db, actor, body, now }) => createReward(db, actor, body, now),
	}),
	route({
		method: "patch",
		url: "/rewards/:id",
		summary: "Modifier ou archiver une envie",
		tag: "Envies",
		params: idParams,
		body: updateRewardBody,
		response: rewardView,
		handler: ({ db, actor, params, body, now }) => updateReward(db, actor, params.id, body, now),
	}),
	route({
		method: "post",
		url: "/rewards/:id/redemptions",
		summary: "Échanger une envie contre des pièces",
		tag: "Envies",
		params: idParams,
		response: redemptionResult,
		status: 201,
		handler: ({ db, actor, params, now }) => redeemReward(db, actor, params.id, now),
	}),
];

export const walletRoutes = [
	route({
		method: "post",
		url: "/transfers",
		summary: "Virer des pièces de son porte-monnaie vers la cagnotte",
		tag: "Pièces",
		body: transferBody,
		response: z.object({ transferId: z.string(), balances: balancesView }),
		status: 201,
		handler: ({ db, actor, body, now }) => transferToShared(db, actor, body.amount, now),
	}),
	route({
		method: "get",
		url: "/ledger",
		summary: "Historique d'un porte-monnaie, paginé par curseur",
		tag: "Pièces",
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
		summary: "Ajustement manuel de pièces (owner)",
		tag: "Pièces",
		body: adjustmentBody,
		response: z.object({ entry: ledgerEntryView }),
		status: 201,
		handler: ({ db, actor, body, now }) => adjust(db, actor, body, now),
	}),
	route({
		method: "get",
		url: "/stats",
		summary: "Séries, taux de réussite et heatmap",
		tag: "Progrès",
		query: statsQuery,
		response: statsView,
		handler: ({ db, actor, query, now }) => getStats(db, actor, query, now),
	}),
];
