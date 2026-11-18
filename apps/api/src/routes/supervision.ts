// SPDX-License-Identifier: AGPL-3.0-or-later
import type { z } from "zod";
import { errors } from "../errors.js";
import {
	completionResult,
	guardianPendingView,
	guardianshipCodeBody,
	guardianshipCodeView,
	potAdjustmentBody,
	potBalanceView,
	redeemCodeBody,
	supervisionView,
	updateWardRightsBody,
	wardCompletionParams,
	wardParams,
	wardPendingView,
	wardView,
} from "../schemas.js";
import { reviewAsGuardian, toCompletionView } from "../services/completions.js";
import { loadActor } from "../services/context.js";
import {
	adjustWard,
	assertGuardian,
	createCode,
	endSupervision,
	listPendingForGuardian,
	listWardPending,
	redeemCode,
	updateWardRights,
	supervisionView as viewOf,
} from "../services/supervision.js";
import { route } from "./define.js";

const base = { scope: "account", tag: "Supervision" } as const;

/** Guardians, wards and the one-time codes that bind them. Guardians never act without the ward's consent. */
export const supervisionRoutes = [
	route({
		...base,
		method: "get",
		url: "/supervision",
		summary: "Who supervises me and who I supervise",
		response: supervisionView,
		handler: ({ db, account }) => viewOf(db, account.userId),
	}),
	route({
		...base,
		method: "get",
		url: "/supervision/pending",
		summary: "Everything waiting for my approval, across the people I supervise",
		response: guardianPendingView,
		handler: ({ db, account }) => ({
			completions: listPendingForGuardian(db, account.userId).map((r) => ({
				...toCompletionView(r.c),
				itemName: r.name,
				wardId: r.wardId,
				wardName: r.wardName,
			})),
		}),
	}),
	route({
		...base,
		method: "post",
		url: "/supervision/codes",
		summary: "Create a one-time code: to supervise whoever uses it, or to be supervised by whoever uses it",
		body: guardianshipCodeBody,
		response: guardianshipCodeView,
		status: 201,
		idempotent: false,
		handler: ({ db, account, body, now }) => createCode(db, account.userId, body.kind, now),
	}),
	route({
		...base,
		method: "post",
		url: "/supervision/redeem",
		summary: "Use a code made by someone else: this completes the consent",
		body: redeemCodeBody,
		response: supervisionView,
		status: 201,
		handler: ({ db, account, body, now }) => {
			redeemCode(db, account.userId, body.code, now);
			return viewOf(db, account.userId);
		},
	}),
	route({
		...base,
		method: "delete",
		url: "/supervision/wards/:wardId",
		summary: "Stop supervising an account (the account becomes unsupervised when its last guardian stops)",
		params: wardParams,
		status: 204,
		handler: ({ db, account, params }) => endSupervision(db, account.userId, params.wardId),
	}),
	route({
		...base,
		method: "patch",
		url: "/supervision/wards/:wardId/rights",
		summary: "Set what a ward may do by themselves",
		params: wardParams,
		body: updateWardRightsBody,
		response: wardView,
		handler: ({ db, account, params, body }) => updateWardRights(db, account.userId, params.wardId, body),
	}),
	route({
		...base,
		method: "post",
		url: "/supervision/wards/:wardId/adjustments",
		summary: "Add or remove coins on a ward's balance, with a note (never on your own)",
		params: wardParams,
		body: potAdjustmentBody,
		response: potBalanceView,
		status: 201,
		handler: ({ db, account, params, body, now }) => adjustWard(db, account.userId, params.wardId, body, now),
	}),
	route({
		...base,
		method: "get",
		url: "/supervision/wards/:wardId/pending",
		summary: "A ward's completions waiting for approval",
		params: wardParams,
		response: wardPendingView,
		handler: ({ db, account, params }) => ({
			completions: listWardPending(db, account.userId, params.wardId).map((r) => ({
				...toCompletionView(r.c),
				itemName: r.name,
			})),
		}),
	}),
	route({
		...base,
		method: "post",
		url: "/supervision/wards/:wardId/completions/:id/approve",
		summary: "Approve a ward's completion",
		params: wardCompletionParams,
		response: completionResult,
		handler: ({ db, account, params, now }) => review(db, account.userId, params, true, now),
	}),
	route({
		...base,
		method: "post",
		url: "/supervision/wards/:wardId/completions/:id/reject",
		summary: "Reject a ward's completion",
		params: wardCompletionParams,
		response: completionResult,
		handler: ({ db, account, params, now }) => review(db, account.userId, params, false, now),
	}),
];

function review(
	db: Parameters<typeof assertGuardian>[0] & Parameters<typeof reviewAsGuardian>[0],
	guardianId: string,
	params: z.output<typeof wardCompletionParams>,
	approve: boolean,
	now: Date,
) {
	assertGuardian(db, guardianId, params.wardId);
	const ward = loadActor(db, params.wardId);
	if (!ward) throw errors.notFound("Ward");
	return reviewAsGuardian(db, guardianId, ward, params.id, approve, now);
}
