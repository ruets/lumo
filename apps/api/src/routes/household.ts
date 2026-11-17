// SPDX-License-Identifier: AGPL-3.0-or-later
import { householdView, idParams, memberView, updateHouseholdBody, updateMemberBody } from "../schemas.js";
import { getHousehold, removeMember, revokeInvite, updateHousehold, updateMember } from "../services/household.js";
import { route } from "./define.js";

export const householdRoutes = [
	route({
		method: "get",
		url: "/household",
		summary: "The household, its members and (owner only) pending invitations",
		tag: "Household",
		response: householdView,
		handler: ({ db, actor, now }) => getHousehold(db, actor, now),
	}),
	route({
		method: "patch",
		url: "/household",
		summary: "Change the household name, time zone, first day of the week or backdate window (owner)",
		tag: "Household",
		body: updateHouseholdBody,
		response: householdView,
		handler: ({ db, actor, body, now }) => updateHousehold(db, actor, body, now),
	}),
	route({
		method: "patch",
		url: "/members/:id",
		summary: "Change a member's role or permission to create items (owner)",
		tag: "Household",
		params: idParams,
		body: updateMemberBody,
		response: memberView,
		handler: ({ db, actor, params, body }) => updateMember(db, actor, params.id, body),
	}),
	route({
		method: "delete",
		url: "/members/:id",
		summary: "Remove a member from the household, keeping their history (owner)",
		tag: "Household",
		params: idParams,
		status: 204,
		handler: ({ db, actor, params }) => removeMember(db, actor, params.id),
	}),
	route({
		method: "delete",
		url: "/household/invites/:id",
		summary: "Revoke a pending invitation (owner)",
		tag: "Household",
		params: idParams,
		status: 204,
		handler: ({ db, actor, params }) => revokeInvite(db, actor, params.id),
	}),
];
