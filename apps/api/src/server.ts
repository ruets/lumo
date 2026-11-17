// SPDX-License-Identifier: AGPL-3.0-or-later

import { lt } from "drizzle-orm";
import { buildApp } from "./app.js";
import { createOidcProvider } from "./auth/oidc.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { oidcStates } from "./db/schema.js";

async function main() {
	const config = loadConfig();
	const { db, sqlite } = openDatabase(config.DATABASE_PATH);

	const oidc =
		config.OIDC_ISSUER && config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET
			? createOidcProvider({
					issuer: config.OIDC_ISSUER,
					clientId: config.OIDC_CLIENT_ID,
					clientSecret: config.OIDC_CLIENT_SECRET,
				})
			: null;

	const app = await buildApp({
		config,
		db,
		oidc,
		logger: { level: config.LOG_LEVEL },
		ping: () => sqlite.prepare("SELECT 1").get(),
	});

	// Nettoyage périodique (les tâches planifiées croner arrivent à l'étape 4).
	const cleanup = setInterval(
		() => {
			purgeExpiredSessions(db);
			db.delete(oidcStates).where(lt(oidcStates.expiresAt, new Date())).run();
		},
		60 * 60 * 1000,
	);
	cleanup.unref();

	const shutdown = async (signal: string) => {
		app.log.info({ signal }, "arrêt");
		await app.close();
		sqlite.close();
		process.exit(0);
	};
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
