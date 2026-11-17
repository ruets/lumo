// SPDX-License-Identifier: AGPL-3.0-or-later
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildOpenApi } from "./openapi.js";
import { allRoutes } from "./routes/index.js";

/** Regenerates `apps/api/openapi.json` (versioned; a test checks it is up to date). */
const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(buildOpenApi(allRoutes), null, "\t")}\n`);
console.log(`spec written: ${target}`);
