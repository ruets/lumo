// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessions, users } from "../db/schema.js";
import {
	api,
	balances,
	createHousehold,
	createTestContext,
	makeHabit,
	sessionCookie,
	type TestContext,
} from "../test/helpers.js";

let ctx: TestContext;
let h: Awaited<ReturnType<typeof createHousehold>>;
beforeEach(async () => {
	ctx = await createTestContext();
	h = await createHousehold(ctx);
});
afterEach(async () => {
	await ctx.close();
});

const PASSWORD = "a-long-password-here";

async function login(username: string, password = PASSWORD) {
	const res = await ctx.app.inject({
		method: "POST",
		url: "/api/v1/auth/local/login",
		payload: { username, password },
	});
	const cookie = sessionCookie(res);
	return { status: res.statusCode, body: res.json(), cookie, api: api(ctx, cookie ?? "") };
}

/** A local account with no household, created by the super admin. */
async function newAccount(username: string) {
	const res = await h.owner.api.post("/admin/users", { displayName: username, username, password: PASSWORD });
	expect(res.statusCode).toBe(201);
	const session = await login(username);
	return { id: res.json().id as string, api: session.api };
}

describe("super admin", () => {
	it("the first account is a super admin and the others are not", async () => {
		expect((await h.owner.api.get("/account")).json()).toMatchObject({ isSuperAdmin: true });
		expect((await h.adult.api.get("/account")).json()).toMatchObject({ isSuperAdmin: false });
		expect((await h.kid.api.get("/account")).json()).toMatchObject({ isSuperAdmin: false });
	});

	it("GET /account works with and without a household", async () => {
		const mine = (await h.owner.api.get("/account")).json();
		expect(mine.household).toMatchObject({ name: "The Smiths", role: "owner" });
		const bare = await newAccount("zoe");
		expect((await bare.api.get("/account")).json()).toMatchObject({ isSuperAdmin: false, household: null });
	});

	it("a household owner is not a super admin: the admin routes are closed to them", async () => {
		await h.owner.api.patch(`/members/${h.adult.userId}`, { role: "owner" });
		for (const call of [
			() => h.adult.api.get("/admin/users"),
			() => h.adult.api.get("/admin/households"),
			() => h.adult.api.post("/admin/users", { displayName: "x", username: "xxx", password: PASSWORD }),
			() => h.adult.api.post("/admin/households", { name: "Nope" }),
			() => h.adult.api.get("/admin/settings"),
		]) {
			expect((await call()).statusCode).toBe(403);
		}
	});
});

describe("accounts without a household", () => {
	it("an account removed from a household keeps its account, credentials and coins", async () => {
		const item = await makeHabit(h.adult, { reward: 5, assigneeIds: [h.kid.userId] });
		await h.kid.api.post(`/items/${item.id}/completions`);
		expect((await balances(h.kid)).personal).toBe(5);

		expect((await h.owner.api.del(`/members/${h.kid.userId}`)).statusCode).toBe(204);

		// Still signed in, still able to sign in again, but without access to the household.
		expect((await h.kid.api.get("/account")).json().household).toBeNull();
		// The app still works for them, on their own: no household, no pot.
		expect((await h.kid.api.get("/me")).json()).toMatchObject({
			household: null,
			role: null,
			wallets: { shared: null },
		});
		expect((await h.kid.api.get("/items")).json().items).toEqual([]);
		expect((await h.kid.api.get("/household")).json().code).toBe("no_household");
		expect((await login("kid")).status).toBe(200);
		expect(ctx.db.select().from(users).where(eq(users.id, h.kid.userId)).get()).toMatchObject({ username: "kid" });
	});

	it("rejoining the same household brings the coins back", async () => {
		const item = await makeHabit(h.adult, { reward: 5, assigneeIds: [h.kid.userId] });
		await h.kid.api.post(`/items/${item.id}/completions`);
		await h.owner.api.del(`/members/${h.kid.userId}`);

		const invite = (await h.owner.api.post("/household/invites", { role: "child" })).json();
		const join = await h.kid.api.post("/household/join", { code: invite.token });
		expect(join.statusCode).toBe(201);
		expect((await balances(h.kid)).personal).toBe(5);
	});

	it("joins another household with a code, and only without a household", async () => {
		const zoe = await newAccount("zoe");
		const invite = (await h.owner.api.post("/household/invites", { role: "adult" })).json();
		expect((await zoe.api.post("/household/join", { code: "not-a-real-invitation-code" })).json().code).toBe(
			"invalid_invite",
		);
		const ok = await zoe.api.post("/household/join", { code: invite.token });
		expect(ok.statusCode).toBe(201);
		expect((await zoe.api.get("/me")).json()).toMatchObject({ role: "adult", household: { name: "The Smiths" } });

		// Already in a household: cannot join another one (single membership for now).
		const second = (await h.owner.api.post("/household/invites", { role: "adult" })).json();
		const again = await zoe.api.post("/household/join", { code: second.token });
		expect(again.statusCode).toBe(409);
		expect(again.json().code).toBe("already_in_household");
	});

	it("leaving a household keeps the account; the last owner cannot leave", async () => {
		expect((await h.kid.api.post("/household/leave")).statusCode).toBe(204);
		expect((await h.kid.api.get("/account")).json().household).toBeNull();

		const last = await h.owner.api.post("/household/leave");
		expect(last.statusCode).toBe(409);
		expect(last.json().code).toBe("last_owner");

		await h.owner.api.patch(`/members/${h.adult.userId}`, { role: "owner" });
		expect((await h.owner.api.post("/household/leave")).statusCode).toBe(204);
	});

	it("an account creates its own household when creation is open, and becomes its owner", async () => {
		const zoe = await newAccount("zoe");
		const res = await zoe.api.post("/households", { name: "Zoe's flat" });
		expect(res.statusCode).toBe(201);
		expect((await zoe.api.get("/me")).json()).toMatchObject({ role: "owner", household: { name: "Zoe's flat" } });
		// An account that already has a household cannot create another one (single membership for now).
		expect((await zoe.api.post("/households", { name: "Second" })).json().code).toBe("already_in_household");
	});

	it("household creation can be restricted to super admins", async () => {
		expect((await h.owner.api.get("/admin/settings")).json()).toEqual({ householdCreation: "anyone" });
		expect((await h.owner.api.patch("/admin/settings", { householdCreation: "admins" })).statusCode).toBe(200);
		const zoe = await newAccount("zoe");
		expect((await zoe.api.post("/households", { name: "Zoe's flat" })).statusCode).toBe(403);
		await h.owner.api.patch("/admin/settings", { householdCreation: "anyone" });
		expect((await zoe.api.post("/households", { name: "Zoe's flat" })).statusCode).toBe(201);
	});
});

describe("admin: accounts", () => {
	it("lists accounts with their household and status, and nothing about their content", async () => {
		const item = await makeHabit(h.adult, { name: "Secret habit", assigneeIds: [h.adult.userId] });
		await h.adult.api.post(`/items/${item.id}/completions`);
		const res = await h.owner.api.get("/admin/users");
		expect(res.statusCode).toBe(200);
		const list = res.json().users;
		expect(list).toHaveLength(3);
		expect(list.find((u: { id: string }) => u.id === h.adult.userId)).toMatchObject({
			displayName: "bob",
			isSuperAdmin: false,
			disabled: false,
			household: { name: "The Smiths", role: "adult" },
		});
		expect(res.body).not.toContain("Secret habit");
	});

	it("creates a local account without a household; the username must be free and the password strong", async () => {
		const ok = await h.owner.api.post("/admin/users", { displayName: "Zoe", username: "zoe", password: PASSWORD });
		expect(ok.statusCode).toBe(201);
		expect(ok.json()).toMatchObject({ displayName: "Zoe", household: null, isSuperAdmin: false });
		expect(
			(await h.owner.api.post("/admin/users", { displayName: "Z", username: "zoe", password: PASSWORD })).statusCode,
		).toBe(409);
		expect(
			(await h.owner.api.post("/admin/users", { displayName: "Z", username: "zed", password: "short" })).statusCode,
		).toBe(400);
	});

	it("grants and removes the super admin role, never leaving the instance without one", async () => {
		expect(
			(await h.owner.api.patch(`/admin/users/${h.adult.userId}`, { isSuperAdmin: true })).json().isSuperAdmin,
		).toBe(true);
		expect((await h.adult.api.get("/admin/users")).statusCode).toBe(200);
		// Two super admins: the first can step down.
		expect((await h.owner.api.patch(`/admin/users/${h.owner.userId}`, { isSuperAdmin: false })).statusCode).toBe(200);
		expect((await h.owner.api.get("/admin/users")).statusCode).toBe(403);
		// The remaining one cannot be demoted.
		const last = await h.adult.api.patch(`/admin/users/${h.adult.userId}`, { isSuperAdmin: false });
		expect(last.statusCode).toBe(409);
		expect(last.json().code).toBe("last_super_admin");
	});

	it("disabling an account ends its sessions and blocks sign-in until it is enabled again", async () => {
		const res = await h.owner.api.patch(`/admin/users/${h.kid.userId}`, { disabled: true });
		expect(res.json().disabled).toBe(true);
		expect((await h.kid.api.get("/account")).statusCode).toBe(401); // the old session is gone
		const blocked = await login("kid");
		expect(blocked.status).toBe(403);
		expect(blocked.body.code).toBe("account_disabled");
		expect(ctx.db.select().from(sessions).where(eq(sessions.userId, h.kid.userId)).all()).toEqual([]);

		await h.owner.api.patch(`/admin/users/${h.kid.userId}`, { disabled: false });
		expect((await login("kid")).status).toBe(200);
	});

	it("deleting an account erases its credentials and sessions and hides it from the list", async () => {
		expect((await h.owner.api.del(`/admin/users/${h.kid.userId}`)).statusCode).toBe(204);
		expect((await h.kid.api.get("/account")).statusCode).toBe(401);
		expect((await login("kid")).status).toBe(401);
		const ids = (await h.owner.api.get("/admin/users")).json().users.map((u: { id: string }) => u.id);
		expect(ids).not.toContain(h.kid.userId);
		// The username is free again.
		expect(
			(await h.owner.api.post("/admin/users", { displayName: "Kid 2", username: "kid", password: PASSWORD }))
				.statusCode,
		).toBe(201);
	});

	it("nobody disables or deletes themselves, nor the last super admin", async () => {
		for (const call of [
			() => h.owner.api.patch(`/admin/users/${h.owner.userId}`, { disabled: true }),
			() => h.owner.api.del(`/admin/users/${h.owner.userId}`),
		]) {
			const res = await call();
			expect(res.statusCode).toBe(409);
			expect(res.json().code).toBe("cannot_target_self");
		}
		await h.owner.api.patch(`/admin/users/${h.adult.userId}`, { isSuperAdmin: true });
		const other = await h.adult.api.del(`/admin/users/${h.owner.userId}`);
		expect(other.statusCode).toBe(204); // two super admins: removing the other one is fine
		expect((await h.owner.api.get("/account")).statusCode).toBe(401);
	});

	it("puts an account into a household and takes it out again, keeping the account", async () => {
		const zoe = await newAccount("zoe");
		const households = (await h.owner.api.get("/admin/households")).json().households;
		const smiths = households[0].id;
		const put = await h.owner.api.post(`/admin/users/${zoe.id}/household`, { householdId: smiths, role: "adult" });
		expect(put.statusCode).toBe(200);
		expect(put.json().household).toMatchObject({ id: smiths, role: "adult" });
		expect((await zoe.api.get("/me")).statusCode).toBe(200);
		// Already in a household: refused.
		expect(
			(await h.owner.api.post(`/admin/users/${zoe.id}/household`, { householdId: smiths, role: "adult" })).statusCode,
		).toBe(409);

		expect((await h.owner.api.del(`/admin/users/${zoe.id}/household`)).statusCode).toBe(204);
		expect((await zoe.api.get("/account")).json().household).toBeNull();
	});
});

describe("admin: households", () => {
	it("creates, renames, lists and deletes an empty household", async () => {
		const created = await h.owner.api.post("/admin/households", { name: "Flat 3" });
		expect(created.statusCode).toBe(201);
		const id = created.json().id as string;
		expect(created.json()).toMatchObject({ name: "Flat 3", memberCount: 0 });

		expect((await h.owner.api.patch(`/admin/households/${id}`, { name: "Flat 4" })).json().name).toBe("Flat 4");
		const list = (await h.owner.api.get("/admin/households")).json().households;
		expect(list).toHaveLength(2);
		expect(list.find((x: { id: string }) => x.id === h.owner.userId)).toBeUndefined();
		expect(list.find((x: { name: string }) => x.name === "The Smiths")).toMatchObject({ memberCount: 3 });

		expect((await h.owner.api.del(`/admin/households/${id}`)).statusCode).toBe(204);
		expect((await h.owner.api.get("/admin/households")).json().households).toHaveLength(1);
	});

	it("refuses to delete a household that still has members", async () => {
		const smiths = (await h.owner.api.get("/admin/households")).json().households[0].id;
		const res = await h.owner.api.del(`/admin/households/${smiths}`);
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("household_not_empty");
	});

	it("a super admin adjusts a household's pot, and the members see it", async () => {
		const smiths = (await h.owner.api.get("/admin/households")).json().households[0].id;
		const res = await h.owner.api.post(`/admin/households/${smiths}/pot/adjustments`, {
			amount: 12,
			note: "Birthday gift",
		});
		expect(res.statusCode).toBe(201);
		expect(res.json().balance).toBe(12);
		expect((await balances(h.kid)).shared).toBe(12);
		expect(
			(await h.owner.api.post(`/admin/households/${smiths}/pot/adjustments`, { amount: 0, note: "x" })).statusCode,
		).toBe(400);
		expect((await h.owner.api.post(`/admin/households/${smiths}/pot/adjustments`, { amount: 3 })).statusCode).toBe(400);
	});
});
