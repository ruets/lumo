// SPDX-License-Identifier: AGPL-3.0-or-later
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildOpenApi } from "./openapi.js";
import { allRoutes } from "./routes/index.js";

/** Régénère `apps/api/openapi.json` (versionné ; un test vérifie qu'il est à jour). */
const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(buildOpenApi(allRoutes), null, "\t")}\n`);
console.log(`spec écrite : ${target}`);
