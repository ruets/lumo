// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import { accountRoutes } from "./account.js";
import { adminRoutes } from "./admin.js";
import type { RouteDef } from "./define.js";
import { householdRoutes } from "./household.js";
import { itemRoutes } from "./items.js";
import { meRoutes } from "./me.js";
import { rewardRoutes, walletRoutes } from "./rewards.js";
import { supervisionRoutes } from "./supervision.js";

/**
 * What a guardian can see and do on a ward's own space, through the very same routes and rules as the ward:
 * profile and balance, the day, stats, items, wishes, history, undoing, giving to a pot. Never completing an
 * item or redeeming a wish: those stay the ward's own acts.
 */
const FOR_WARDS = new Set([
	"get /me",
	"get /today",
	"get /stats",
	"get /items",
	"post /items",
	"patch /items/:id",
	"delete /items/:id",
	"get /rewards",
	"post /rewards",
	"patch /rewards/:id",
	"get /ledger",
	"delete /completions/:id",
	"delete /redemptions/:id",
	"post /transfers",
]);

function forWards(defs: readonly RouteDef[]): RouteDef[] {
	return defs
		.filter((d) => FOR_WARDS.has(`${d.method} ${d.url}`))
		.map((d) => {
			const wardId = z.string().min(1).max(100);
			const params = d.params instanceof z.ZodObject ? d.params.extend({ wardId }) : z.object({ wardId });
			return { ...d, url: `/supervision/wards/:wardId${d.url}`, params, ward: true, tag: "Supervision" };
		});
}

const own = [
	...meRoutes,
	...accountRoutes,
	...adminRoutes,
	...householdRoutes,
	...itemRoutes,
	...rewardRoutes,
	...walletRoutes,
];

/** All the API's declarative routes: source of validation and of the OpenAPI spec. */
export const allRoutes = [...own, ...supervisionRoutes, ...forWards(own)];
