// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { errors } from "../errors.js";
import { accountView, createHouseholdBody, joinHouseholdBody } from "../schemas.js";
import { createOwnHousehold, joinWithCode, leaveHousehold } from "../services/household.js";
import { getSettings } from "../services/settings.js";
import { route } from "./define.js";

export const accountRoutes = [
	route({
		scope: "account",
		method: "get",
		url: "/account",
		summary: "The signed-in account, with or without a household",
		tag: "Account",
		response: accountView,
		handler: ({ db, account }) => {
			const user = db.select().from(users).where(eq(users.id, account.userId)).get();
			if (!user) throw errors.unauthenticated();
			return {
				user: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
				isSuperAdmin: account.isSuperAdmin,
				household: account.household,
				canCreateHousehold: account.isSuperAdmin || getSettings(db).householdCreation === "anyone",
			};
		},
	}),
	route({
		scope: "account",
		method: "post",
		url: "/households",
		summary: "Create a household and become its owner (when the instance allows it)",
		tag: "Account",
		body: createHouseholdBody,
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
