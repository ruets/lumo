// SPDX-License-Identifier: AGPL-3.0-or-later
import { createClient } from "@lumo/api-client";
import { getActiveHouseholdId } from "./household";

/** Same origin as the page: the HttpOnly session cookie is enough, no token in JavaScript. */
export const api = createClient({ baseUrl: "", getHouseholdId: getActiveHouseholdId });
