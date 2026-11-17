// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Ouvre la base (WAL, clés étrangères actives) et applique les migrations en attente. */
export function openDatabase(path: string): { db: Db; sqlite: Database.Database } {
	mkdirSync(dirname(path), { recursive: true });
	const sqlite = new Database(path);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("synchronous = NORMAL");
	sqlite.pragma("foreign_keys = ON");
	sqlite.pragma("busy_timeout = 5000");
	const db = createDb(sqlite);
	migrate(db, { migrationsFolder });
	return { db, sqlite };
}

export function createDb(sqlite: Database.Database): Db {
	return drizzle(sqlite, { schema });
}

export { schema };
