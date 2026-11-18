// SPDX-License-Identifier: AGPL-3.0-or-later

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveOidcLogin } from "../auth/identity.js";
import { itemAssignees, ledgerEntries, users } from "../db/schema.js";
import { balances, createHousehold, createTestContext, makeHabit, type TestContext } from "../test/helpers.js";

let ctx: TestContext;
let h: Awaited<ReturnType<typeof createHousehold>>;
beforeEach(async () => {
	ctx = await createTestContext();
	h = await createHousehold(ctx);
});
afterEach(async () => {
	await ctx.close();
});

const register = (token: string, username: string) =>
	ctx.app.inject({
		method: "POST",
		url: "/api/v1/auth/local/register",
		payload: { invite: token, displayName: username, username, password: "a-long-password-here" },
	});

describe("GET /household", () => {
	it("any member sees the household settings and the member list", async () => {
		for (const who of [h.owner, h.adult, h.kid]) {
			const res = (await who.api.get("/household")).json();
			expect(res.household).toMatchObject({ name: "The Smiths", backdateDays: 2 });
			expect(res.members).toHaveLength(3);
		}
		const members = (await h.kid.api.get("/household")).json().members;
		expect(members).toContainEqual({
			userId: h.owner.userId,
			displayName: "Alice",
			role: "owner",
			canCreateItems: false,
		});
		expect(members).toContainEqual({
			userId: h.adult.userId,
			displayName: "bob",
			role: "adult",
			canCreateItems: false,
		});
		expect(members).toContainEqual({ userId: h.kid.userId, displayName: "kid", role: "child", canCreateItems: false });
	});

	it("pending invitations are only visible to the owner", async () => {
		await h.owner.api.post("/household/invites", { role: "child" });
		const mine = (await h.owner.api.get("/household")).json().invites;
		expect(mine).toHaveLength(1);
		expect(mine[0]).toMatchObject({ role: "child" });
		expect(mine[0].token).toBeUndefined(); // the token is only shown once, at creation
		expect((await h.adult.api.get("/household")).json().invites).toEqual([]);
	});

	it("used and expired invitations are not listed", async () => {
		const used = (await h.owner.api.post("/household/invites", { role: "adult" })).json();
		await register(used.token, "carol");
		await h.owner.api.post("/household/invites", { role: "child" });
		ctx.clock.now = new Date("2026-11-30T10:00:00Z"); // 13 days later: the 7-day invitation has expired
		expect((await h.owner.api.get("/household")).json().invites).toEqual([]);
	});
});

describe("PATCH /members/:id", () => {
	it("the owner changes a role and the child's permission to create items", async () => {
		const res = await h.owner.api.patch(`/members/${h.kid.userId}`, { role: "adult", canCreateItems: true });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ userId: h.kid.userId, role: "adult", canCreateItems: true });
		const members = (await h.owner.api.get("/household")).json().members;
		expect(members.find((m: { userId: string }) => m.userId === h.kid.userId)).toMatchObject({ role: "adult" });
	});

	it("the new rights apply right away", async () => {
		const create = () =>
			h.kid.api.post("/items", { kind: "habit", name: "Read", schedule: { type: "daily" }, reward: 1 });
		expect((await create()).statusCode).toBe(403);
		await h.owner.api.patch(`/members/${h.kid.userId}`, { canCreateItems: true });
		expect((await create()).statusCode).toBe(201);
	});

	it("only the owner manages members", async () => {
		expect((await h.adult.api.patch(`/members/${h.kid.userId}`, { role: "adult" })).statusCode).toBe(403);
		expect((await h.kid.api.patch(`/members/${h.kid.userId}`, { role: "owner" })).statusCode).toBe(403);
		expect(
			(await h.owner.api.get("/household")).json().members.find((m: { userId: string }) => m.userId === h.kid.userId)
				.role,
		).toBe("child");
	});

	it("refuses to demote the last owner (409 last_owner)", async () => {
		const res = await h.owner.api.patch(`/members/${h.owner.userId}`, { role: "adult" });
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("last_owner");
	});

	it("an owner can step down once another owner exists", async () => {
		expect((await h.owner.api.patch(`/members/${h.adult.userId}`, { role: "owner" })).statusCode).toBe(200);
		expect((await h.owner.api.patch(`/members/${h.owner.userId}`, { role: "adult" })).statusCode).toBe(200);
		// Alice is now an adult: she cannot manage members any more, Bob can.
		expect((await h.owner.api.patch(`/members/${h.kid.userId}`, { role: "adult" })).statusCode).toBe(403);
		expect((await h.adult.api.patch(`/members/${h.kid.userId}`, { role: "adult" })).statusCode).toBe(200);
	});

	it("validates the body and the target", async () => {
		expect((await h.owner.api.patch(`/members/${h.kid.userId}`, {})).statusCode).toBe(400);
		expect((await h.owner.api.patch(`/members/${h.kid.userId}`, { role: "king" })).statusCode).toBe(400);
		expect((await h.owner.api.patch(`/members/${h.kid.userId}`, { role: "adult", name: "x" })).statusCode).toBe(400);
		expect((await h.owner.api.patch("/members/unknown", { role: "adult" })).statusCode).toBe(404);
	});
});

describe("DELETE /household/invites/:id", () => {
	it("the owner revokes a pending invitation, which can no longer be used", async () => {
		const invite = (await h.owner.api.post("/household/invites", { role: "child" })).json();
		const [pending] = (await h.owner.api.get("/household")).json().invites;
		expect((await h.owner.api.del(`/household/invites/${pending.id}`)).statusCode).toBe(204);
		expect((await h.owner.api.get("/household")).json().invites).toEqual([]);
		const res = await register(invite.token, "dave");
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("invalid_invite");
	});

	it("only the owner revokes, and unknown or used invitations are 404", async () => {
		await h.owner.api.post("/household/invites", { role: "child" });
		const [pending] = (await h.owner.api.get("/household")).json().invites;
		expect((await h.adult.api.del(`/household/invites/${pending.id}`)).statusCode).toBe(403);
		expect((await h.owner.api.del("/household/invites/unknown")).statusCode).toBe(404);
	});
});

describe("DELETE /members/:id", () => {
	it("the owner removes a member, who loses the household but keeps the account", async () => {
		expect((await h.kid.api.get("/me")).statusCode).toBe(200);
		expect((await h.owner.api.del(`/members/${h.kid.userId}`)).statusCode).toBe(204);
		const members = (await h.owner.api.get("/household")).json().members;
		expect(members.map((m: { userId: string }) => m.userId).sort()).toEqual([h.owner.userId, h.adult.userId].sort());
		expect((await h.kid.api.get("/household")).statusCode).toBe(403); // no household any more
		const login = await ctx.app.inject({
			method: "POST",
			url: "/api/v1/auth/local/login",
			payload: { username: "kid", password: "a-long-password-here" },
		});
		expect(login.statusCode).toBe(200); // the account and its credentials stay
	});

	it("keeps the account, the credentials and the history", async () => {
		const item = await makeHabit(h.adult, { reward: 5, assigneeIds: [h.kid.userId] });
		await h.kid.api.post(`/items/${item.id}/completions`);
		expect((await balances(h.kid)).personal).toBe(5);
		const entriesBefore = ctx.db.select().from(ledgerEntries).all().length;

		await h.owner.api.del(`/members/${h.kid.userId}`);
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(entriesBefore); // the ledger is untouched
		expect(ctx.db.select().from(users).where(eq(users.id, h.kid.userId)).get()).toMatchObject({
			displayName: "kid",
			username: "kid",
		});
		expect(ctx.db.select().from(users).where(eq(users.id, h.kid.userId)).get()?.passwordHash).not.toBeNull();
	});

	it("unassigns the member from items and drops their pending approvals", async () => {
		const item = await makeHabit(h.adult, { assigneeIds: [h.kid.userId], requiresApproval: true });
		await h.kid.api.post(`/items/${item.id}/completions`);
		expect((await h.adult.api.get("/completions?status=pending")).json().completions).toHaveLength(1);

		await h.owner.api.del(`/members/${h.kid.userId}`);
		expect(ctx.db.select().from(itemAssignees).where(eq(itemAssignees.userId, h.kid.userId)).all()).toEqual([]);
		expect((await h.adult.api.get("/completions?status=pending")).json().completions).toEqual([]);
	});

	it("a removed OIDC member can still sign in, and an invitation brings them back", async () => {
		const invite = (await h.owner.api.post("/household/invites", { role: "adult" })).json();
		const claims = { sub: "sub-zoe", name: "Zoe", email: null, picture: null, groups: [] };
		const { userId } = resolveOidcLogin(ctx.db, ctx.config, claims, invite.token);
		await h.owner.api.del(`/members/${userId}`);
		expect(() => resolveOidcLogin(ctx.db, ctx.config, claims, null)).not.toThrow();
		const again = (await h.owner.api.post("/household/invites", { role: "adult" })).json();
		expect(() => resolveOidcLogin(ctx.db, ctx.config, claims, again.token)).not.toThrow();
	});

	it("refuses to remove yourself, and only the owner can remove", async () => {
		const self = await h.owner.api.del(`/members/${h.owner.userId}`);
		expect(self.statusCode).toBe(409);
		expect(self.json().code).toBe("cannot_remove_self");
		expect((await h.adult.api.del(`/members/${h.kid.userId}`)).statusCode).toBe(403);
		expect((await h.owner.api.del("/members/unknown")).statusCode).toBe(404);
	});

	it("an owner can remove another owner", async () => {
		await h.owner.api.patch(`/members/${h.adult.userId}`, { role: "owner" });
		expect((await h.owner.api.del(`/members/${h.adult.userId}`)).statusCode).toBe(204);
	});
});

describe("PATCH /household", () => {
	it("the owner updates the name and the backdate window", async () => {
		const res = await h.owner.api.patch("/household", {
			name: "The Browns",
			backdateDays: 5,
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().household).toMatchObject({
			name: "The Browns",
			backdateDays: 5,
		});
		expect((await h.kid.api.get("/household")).json().household.name).toBe("The Browns");
		expect((await h.kid.api.get("/me")).json().household.name).toBe("The Browns");
	});

	it("partial updates leave the other fields alone", async () => {
		await h.owner.api.patch("/household", { backdateDays: 0 });
		expect((await h.owner.api.get("/household")).json().household).toMatchObject({
			name: "The Smiths",
			backdateDays: 0,
		});
	});

	it("the new settings apply right away", async () => {
		const item = await makeHabit(h.adult);
		// Yesterday is inside the default 2-day window …
		expect((await h.adult.api.post(`/items/${item.id}/completions`, { date: "2026-11-16" })).statusCode).toBe(201);
		// … but not once the window is 0 (only an owner can go back further).
		await h.owner.api.patch("/household", { backdateDays: 0 });
		const second = await h.adult.api.post(`/items/${item.id}/completions`, { date: "2026-11-15" });
		expect(second.statusCode).toBe(403);
		expect(second.json().code).toBe("backdate_not_allowed");

		// 23:30 UTC on the 17th is already the 18th in Paris, still the 17th in New York.
		ctx.clock.now = new Date("2026-11-17T23:30:00Z");
		expect((await h.owner.api.get("/today")).json().date).toBe("2026-11-18");
		// The time zone is the person's own, not the household's.
		await h.owner.api.patch("/account", { timezone: "America/New_York" });
		expect((await h.owner.api.get("/today")).json().date).toBe("2026-11-17");
	});

	it("the backdate limit can be turned off (null) and back on", async () => {
		const item = await makeHabit(h.adult);
		await h.owner.api.patch("/household", { backdateDays: 0 });
		expect((await h.adult.api.post(`/items/${item.id}/completions`, { date: "2026-11-16" })).statusCode).toBe(403);

		const off = await h.owner.api.patch("/household", { backdateDays: null });
		expect(off.statusCode).toBe(200);
		expect(off.json().household.backdateDays).toBeNull();
		expect((await h.kid.api.get("/household")).json().household.backdateDays).toBeNull();
		// No limit: an adult can complete a day months ago (never the future).
		expect((await h.adult.api.post(`/items/${item.id}/completions`, { date: "2026-03-01" })).statusCode).toBe(201);
		const future = await h.adult.api.post(`/items/${item.id}/completions`, { date: "2026-11-18" });
		expect(future.json().code).toBe("future_date");

		const on = await h.owner.api.patch("/household", { backdateDays: 3 });
		expect(on.json().household.backdateDays).toBe(3);
		expect((await h.adult.api.post(`/items/${item.id}/completions`, { date: "2026-02-01" })).statusCode).toBe(403);
	});

	it("only the owner can change the household", async () => {
		expect((await h.adult.api.patch("/household", { name: "Hijacked" })).statusCode).toBe(403);
		expect((await h.kid.api.patch("/household", { name: "Hijacked" })).statusCode).toBe(403);
		expect((await h.owner.api.get("/household")).json().household.name).toBe("The Smiths");
	});

	it("validates every field", async () => {
		const bad = (body: object) => h.owner.api.patch("/household", body).then((r) => r.statusCode);
		expect(await bad({})).toBe(400);
		expect(await bad({ name: "  " })).toBe(400);
		expect(await bad({ name: "x".repeat(81) })).toBe(400);
		expect(await bad({ timezone: "Mars/Phobos" })).toBe(400);
		expect(await bad({ weekStart: 0 })).toBe(400);
		expect(await bad({ weekStart: 8 })).toBe(400);
		expect(await bad({ backdateDays: -1 })).toBe(400);
		expect(await bad({ backdateDays: 31 })).toBe(400);
		expect(await bad({ backdateDays: 1.5 })).toBe(400);
		expect(await bad({ name: "ok", color: "red" })).toBe(400);
	});
});
