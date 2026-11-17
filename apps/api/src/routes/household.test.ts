// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHousehold, createTestContext, type TestContext } from "../test/helpers.js";

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
			expect(res.household).toMatchObject({ name: "The Smiths", timezone: "Europe/Paris", backdateDays: 2 });
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
