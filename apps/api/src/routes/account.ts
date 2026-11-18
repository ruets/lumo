// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { errors } from "../errors.js";
import { accountView, createHouseholdBody, householdIdView, joinHouseholdBody, updateAccountBody } from "../schemas.js";
import { updateAccount } from "../services/accounts.js";
import { loadAccount } from "../services/context.js";
import { createOwnHousehold, joinWithCode, leaveHousehold } from "../services/household.js";
import type { DbOrTx } from "../services/members.js";
import { getSettings } from "../services/settings.js";
import { route } from "./define.js";

function accountOverview(db: DbOrTx, userId: string) {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	const account = loadAccount(db, userId);
	if (!user || !account) throw errors.unauthenticated();
	return {
		user: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
		isSuperAdmin: account.isSuperAdmin,
		households: account.households,
		oidc: user.oidcSubject !== null,
		timezone: user.timezone,
		weekStart: user.weekStart,
		canCreateHousehold: account.isSuperAdmin || getSettings(db).householdCreation === "anyone",
	};
}

export const accountRoutes = [
	route({
		scope: "account",
		method: "get",
		url: "/account",
		summary: "The signed-in account, with or without a household",
		tag: "Account",
		response: accountView,
		handler: ({ db, account }) => accountOverview(db, account.userId),
	}),
	route({
		scope: "account",
		method: "patch",
		url: "/account",
		summary: "Change your name, time zone or first day of the week",
		tag: "Account",
		body: updateAccountBody,
		response: accountView,
		handler: ({ db, account, body }) => {
			updateAccount(db, account.userId, body);
			return accountOverview(db, account.userId);
		},
	}),
	route({
		scope: "account",
		method: "post",
		url: "/households",
		summary: "Create a household and become its owner (when the instance allows it)",
		tag: "Account",
		body: createHouseholdBody,
		response: householdIdView,
		status: 201,
		handler: ({ db, account, body }) =>
			createOwnHousehold(db, account, body.name, getSettings(db).householdCreation === "anyone"),
	}),
	route({
		scope: "account",
		method: "post",
		url: "/household/join",
		summary: "Join a household with an invitation code (accounts without a household)",
		tag: "Account",
		body: joinHouseholdBody,
		response: householdIdView,
		status: 201,
		handler: ({ db, account, body, now }) => joinWithCode(db, account, body.code, now),
	}),
	route({
		method: "post",
		url: "/household/leave",
		summary: "Leave the household and keep the account (never the last owner)",
		tag: "Account",
		status: 204,
		handler: ({ db, actor }) => leaveHousehold(db, actor),
	}),
];
