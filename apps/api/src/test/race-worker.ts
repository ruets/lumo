// SPDX-License-Identifier: AGPL-3.0-or-later
import { parentPort, workerData } from "node:worker_threads";
import { buildApp } from "../app.js";
import type { Config } from "../config.js";
import { openDatabase } from "../db/client.js";

/**
 * Thread de test : sa propre connexion SQLite sur le même fichier, donc une vraie concurrence
 * entre écrivains (verrou `BEGIN IMMEDIATE`), contrairement à des requêtes dans un seul process.
 */
const { dbPath, config, cookie, url, payload, count, now } = workerData as {
	dbPath: string;
	config: Config;
	cookie: string;
	url: string;
	payload: unknown;
	count: number;
	now: string;
};

const { db, sqlite } = openDatabase(dbPath);
const app = await buildApp({ config, db, oidc: null, clock: () => new Date(now) });
await app.ready();

// Tous les threads démarrent leurs rafales au même signal.
await new Promise<void>((resolve) => parentPort?.once("message", () => resolve()));

const responses = await Promise.all(
	Array.from({ length: count }, (_, i) =>
		app.inject({
			method: "POST",
			url: `/api/v1${url}`,
			payload: payload as object,
			headers: {
				cookie: `lumo_session=${cookie}`,
				origin: new URL(config.PUBLIC_URL).origin,
				"idempotency-key": crypto.randomUUID(),
				"x-i": String(i),
			},
		}),
	),
);
parentPort?.postMessage(responses.map((r) => r.statusCode));
await app.close();
sqlite.close();
