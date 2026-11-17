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
	exec("INSERT INTO households (id, name) VALUES (?, ?)", hid, "Household");
	exec("INSERT INTO users (id, display_name) VALUES (?, ?)", uid, "Alice");
	exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'personal', ?)", wid, hid, uid);
	return { hid, uid, wid };
}

describe("migrations", () => {
	it("creates the schema's 17 tables", () => {
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
				"instance_settings",
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

	it("opens the database in WAL mode with foreign keys on", () => {
		expect(ctx.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
		expect(ctx.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
	});

	it("creates the planned indexes", () => {
		const idx = (
			ctx.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
		).map((r) => r.name);
		expect(idx).toContain("completions_item_user_date_idx");
		expect(idx).toContain("ledger_entries_wallet_created_idx");
	});
});

describe("contraintes", () => {
	it("rejects an unknown foreign key", () => {
		expect(() => exec("INSERT INTO memberships (household_id, user_id, role) VALUES ('x', 'y', 'owner')")).toThrow(
			/FOREIGN KEY/,
		);
	});

	it("rejects an unknown role", () => {
		const { hid, uid } = seed();
		expect(() =>
			exec("INSERT INTO memberships (household_id, user_id, role) VALUES (?, ?, 'admin')", hid, uid),
		).toThrow(/CHECK/);
	});

	it("requires a user_id for personal wallets and not for pots", () => {
		const { hid } = seed();
		expect(() =>
			exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'personal', NULL)", randomUUID(), hid),
		).toThrow(/CHECK/);
		exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'shared', NULL)", randomUUID(), hid);
	});

	it("allows only one pot per household", () => {
		const { hid } = seed();
		exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'shared', NULL)", randomUUID(), hid);
		expect(() =>
			exec("INSERT INTO wallets (id, household_id, kind, user_id) VALUES (?, ?, 'shared', NULL)", randomUUID(), hid),
		).toThrow(/UNIQUE/);
	});

	it("rejects a duplicate username or OIDC sub", () => {
		exec("INSERT INTO users (id, display_name, username, oidc_subject) VALUES (?, 'A', 'alice', 'sub1')", randomUUID());
		expect(() => exec("INSERT INTO users (id, display_name, username) VALUES (?, 'B', 'alice')", randomUUID())).toThrow(
			/UNIQUE/,
		);
		expect(() =>
			exec("INSERT INTO users (id, display_name, oidc_subject) VALUES (?, 'B', 'sub1')", randomUUID()),
		).toThrow(/UNIQUE/);
	});

	it("rejects a malformed local_date", () => {
		const { hid, uid } = seed();
		const itemId = randomUUID();
		exec(
			"INSERT INTO items (id, household_id, kind, name, created_by) VALUES (?, ?, 'habit', 'Water', ?)",
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

describe("ledger_entries (append-only)", () => {
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

	it("accepts appending, with a default timestamp", () => {
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
		expect(() => exec("UPDATE ledger_entries SET amount = 999 WHERE id = ?", id)).toThrow(/append-only/);
	});

	it("refuse toute suppression", () => {
		const { hid, wid, uid } = seed();
		const id = insertEntry(hid, wid, uid);
		expect(() => exec("DELETE FROM ledger_entries WHERE id = ?", id)).toThrow(/append-only/);
	});

	it("rejects a zero entry", () => {
		const { hid, wid, uid } = seed();
		expect(() => insertEntry(hid, wid, uid, 0)).toThrow(/CHECK/);
	});
});
