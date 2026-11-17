// SPDX-License-Identifier: AGPL-3.0-or-later
import { itemRoutes } from "./items.js";
import { meRoutes } from "./me.js";
import { rewardRoutes, walletRoutes } from "./rewards.js";

/** Toutes les routes déclaratives de l'API : source de la validation et de la spec OpenAPI. */
export const allRoutes = [...meRoutes, ...itemRoutes, ...rewardRoutes, ...walletRoutes];
