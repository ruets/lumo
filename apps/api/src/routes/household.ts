// SPDX-License-Identifier: AGPL-3.0-or-later
import { householdView, idParams, memberView, updateMemberBody } from "../schemas.js";
import { getHousehold, revokeInvite, updateMember } from "../services/household.js";
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
		url: "/household/invites/:id",
		summary: "Revoke a pending invitation (owner)",
		tag: "Household",
		params: idParams,
		status: 204,
		handler: ({ db, actor, params }) => revokeInvite(db, actor, params.id),
	}),
];
