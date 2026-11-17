// SPDX-License-Identifier: AGPL-3.0-or-later
import { householdRoutes } from "./household.js";
import { itemRoutes } from "./items.js";
import { meRoutes } from "./me.js";
import { rewardRoutes, walletRoutes } from "./rewards.js";

/** All the API's declarative routes: source of validation and of the OpenAPI spec. */
export const allRoutes = [...meRoutes, ...householdRoutes, ...itemRoutes, ...rewardRoutes, ...walletRoutes];
