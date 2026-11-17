// SPDX-License-Identifier: AGPL-3.0-or-later
import { createClient } from "@lumo/api-client";

/** Même origine que la page : le cookie de session HttpOnly suffit, aucun jeton côté JavaScript. */
export const api = createClient({ baseUrl: "" });
