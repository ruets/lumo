// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../test/helpers.js";

let ctx: TestContext;
beforeEach(async () => {
	ctx = await createTestContext();
});
afterEach(async () => {
	await ctx.close();
});

const exec = (sql: string, ...params: unknown[]) => ctx.sqlite.prepare(sql).run(...params);

function seed() {
	const hid = randomUUID();
	const uid = randomUUID();
	const wid = randomUUID();
	exec("INSERT INTO households (id, name) VALUES (?, ?)", hid, "Foyer");
	exec("INSERT INTO users (id, display_name) VALUES (?, ?)", uid, "Alice");
	exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'personal', ?)", wid, hid, uid);
	return { hid, uid, wid };
}

describe("migrations", () => {
	it("crée les 16 tables du schéma", () => {
		const names = ctx.sqlite
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'",
			)
			.all()
			.map((r) => (r as { name: string }).name);
		expect(names.sort()).toEqual(
			[
				"completions",
				"devices",
				"households",
				"idempotency_keys",
				"invites",
				"item_assignees",
				"items",
				"ledger_entries",
				"memberships",
				"oidc_states",
				"redemptions",
				"reward_assignees",
				"rewards",
				"sessions",
				"users",
				"wallets",
			].sort(),
		);
	});

	it("ouvre la base en WAL avec les clés étrangères actives", () => {
		expect(ctx.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
		expect(ctx.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
	});

	it("crée les index prévus", () => {
		const idx = (
			ctx.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
		).map((r) => r.name);
		expect(idx).toContain("completions_item_user_date_idx");
		expect(idx).toContain("ledger_entries_wallet_created_idx");
	});
});

describe("contraintes", () => {
	it("refuse une clé étrangère inconnue", () => {
		expect(() => exec("INSERT INTO memberships (household_id, user_id, role) VALUES ('x', 'y', 'owner')")).toThrow(
			/FOREIGN KEY/,
		);
	});

	it("refuse un rôle inconnu", () => {
		const { hid, uid } = seed();
		expect(() =>
			exec("INSERT INTO memberships (household_id, user_id, role) VALUES (?, ?, 'admin')", hid, uid),
		).toThrow(/CHECK/);
	});

	it("impose un user_id aux porte-monnaie personnels et pas aux cagnottes", () => {
		const { hid } = seed();
		expect(() =>
			exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'personal', NULL)", randomUUID(), hid),
		).toThrow(/CHECK/);
		exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'shared', NULL)", randomUUID(), hid);
	});

	it("n'autorise qu'une cagnotte par foyer", () => {
		const { hid } = seed();
		exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'shared', NULL)", randomUUID(), hid);
		expect(() =>
			exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'shared', NULL)", randomUUID(), hid),
		).toThrow(/UNIQUE/);
	});

	it("refuse un username ou un sub OIDC en double", () => {
		exec("INSERT INTO users (id, display_name, username, oidc_subject) VALUES (?, 'A', 'alice', 'sub1')", randomUUID());
		expect(() => exec("INSERT INTO users (id, display_name, username) VALUES (?, 'B', 'alice')", randomUUID())).toThrow(
			/UNIQUE/,
		);
		expect(() =>
			exec("INSERT INTO users (id, display_name, oidc_subject) VALUES (?, 'B', 'sub1')", randomUUID()),
		).toThrow(/UNIQUE/);
	});

	it("refuse une local_date mal formée", () => {
		const { hid, uid } = seed();
		const itemId = randomUUID();
		exec(
			"INSERT INTO items (id, household_id, kind, name, created_by) VALUES (?, ?, 'habit', 'Eau', ?)",
			itemId,
			hid,
			uid,
		);
		expect(() =>
			exec(
				"INSERT INTO completions (id, item_id, user_id, local_date, completed_at) VALUES (?, ?, ?, '17/11/2026', 0)",
				randomUUID(),
				itemId,
				uid,
			),
		).toThrow(/CHECK/);
	});
});

describe("ledger_entries (ajout seul)", () => {
	const insertEntry = (hid: string, wid: string, uid: string, amount = 5) => {
		const id = randomUUID();
		exec(
			"INSERT INTO ledger_entries (id, household_id, wallet_id, amount, reason, created_by) VALUES (?, ?, ?, ?, 'adjustment', ?)",
			id,
			hid,
			wid,
			amount,
			uid,
		);
		return id;
	};

	it("accepte l'ajout, avec un horodatage par défaut", () => {
		const { hid, wid, uid } = seed();
		const id = insertEntry(hid, wid, uid);
		const row = ctx.sqlite.prepare("SELECT created_at FROM ledger_entries WHERE id = ?").get(id) as {
			created_at: number;
		};
		expect(Math.abs(row.created_at - Date.now())).toBeLessThan(5000);
	});

	it("refuse toute modification", () => {
		const { hid, wid, uid } = seed();
		const id = insertEntry(hid, wid, uid);
		expect(() => exec("UPDATE ledger_entries SET amount = 999 WHERE id = ?", id)).toThrow(/ajout seul/);
	});

	it("refuse toute suppression", () => {
		const { hid, wid, uid } = seed();
		const id = insertEntry(hid, wid, uid);
		expect(() => exec("DELETE FROM ledger_entries WHERE id = ?", id)).toThrow(/ajout seul/);
	});

	it("refuse une écriture à zéro", () => {
		const { hid, wid, uid } = seed();
		expect(() => insertEntry(hid, wid, uid, 0)).toThrow(/CHECK/);
	});
});
