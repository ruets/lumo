// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memberships } from "../db/schema.js";
import { createHousehold, createTestContext, makeHabit, type TestContext } from "../test/helpers.js";

let ctx: TestContext;
let h: Awaited<ReturnType<typeof createHousehold>>;
beforeEach(async () => {
	ctx = await createTestContext();
	h = await createHousehold(ctx);
});
afterEach(async () => {
	await ctx.close();
});

describe("creation", () => {
	it("a daily habit, assigned to its creator by default", async () => {
		const res = await h.owner.api.post("/items", {
			kind: "habit",
			name: "Drink water",
			schedule: { type: "daily" },
			targetPerPeriod: 3,
			reward: 2,
			pinned: true,
		});
		expect(res.statusCode).toBe(201);
		expect(res.json()).toMatchObject({
			kind: "habit",
			name: "Drink water",
			schedule: { type: "daily" },
			targetPerPeriod: 3,
			reward: 2,
			creditsTo: "personal",
			pinned: true,
			requiresApproval: false,
			archivedAt: null,
			createdBy: h.owner.userId,
			assigneeIds: [h.owner.userId],
		});
	});

	it("a one-off task with a due date: goal forced to 1, no schedule", async () => {
		const res = await h.owner.api.post("/items", {
			kind: "task",
			name: "Call the plumber",
			reward: 10,
			dueAt: "2026-11-30T12:00:00Z",
			targetPerPeriod: 5,
		});
		expect(res.statusCode).toBe(201);
		expect(res.json()).toMatchObject({
			kind: "task",
			schedule: null,
			targetPerPeriod: 1,
			dueAt: "2026-11-30T12:00:00.000Z",
		});
	});

	it("rejects a habit without a schedule, an invalid schedule, a negative reward", async () => {
		const noSchedule = await h.owner.api.post("/items", { kind: "habit", name: "x", reward: 1 });
		expect(noSchedule.statusCode).toBe(400);
		expect(noSchedule.json().code).toBe("validation_error");
		expect(
			(await h.owner.api.post("/items", { kind: "habit", name: "x", schedule: { type: "weekly", days: [] } }))
				.statusCode,
		).toBe(400);
		expect(
			(await h.owner.api.post("/items", { kind: "habit", name: "x", schedule: { type: "daily" }, reward: -1 }))
				.statusCode,
		).toBe(400);
	});

	it("requires an Idempotency-Key on writes", async () => {
		const res = await h.owner.api.post("/items", { kind: "task", name: "x" }, { "idempotency-key": "" });
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("idempotency_key_required");
	});

	it("an adult creates for a child (assignment, item shared between members)", async () => {
		const item = await makeHabit(h.adult, { assigneeIds: [h.kid.userId, h.adult.userId] });
		expect(item.assigneeIds.sort()).toEqual([h.kid.userId, h.adult.userId].sort());
	});

	it("refuses to assign someone who is not a member of the household", async () => {
		const res = await h.owner.api.post("/items", { kind: "task", name: "x", assigneeIds: ["inconnu"] });
		expect(res.statusCode).toBe(400);
	});
});

describe("creation rights", () => {
	it("a child creates nothing by default", async () => {
		const res = await h.kid.api.post("/items", { kind: "task", name: "Ranger" });
		expect(res.statusCode).toBe(403);
		expect(res.json().code).toBe("forbidden");
	});

	it("an allowed child creates for themselves only", async () => {
		ctx.db.update(memberships).set({ canCreateItems: true }).where(eq(memberships.userId, h.kid.userId)).run();
		expect((await h.kid.api.post("/items", { kind: "task", name: "Ranger" })).statusCode).toBe(201);
		const forOther = await h.kid.api.post("/items", { kind: "task", name: "Ranger", assigneeIds: [h.adult.userId] });
		expect(forOther.statusCode).toBe(403);
	});
});

describe("lecture, modification, archivage", () => {
	it("a child only sees what is assigned to them or what they created; an adult sees everything", async () => {
		const mine = await makeHabit(h.adult, { name: "For the child", assigneeIds: [h.kid.userId] });
		await makeHabit(h.adult, { name: "For the adult" });
		const kidItems = (await h.kid.api.get("/items")).json().items;
		expect(kidItems.map((i: { id: string }) => i.id)).toEqual([mine.id]);
		expect((await h.adult.api.get("/items")).json().items).toHaveLength(2);
	});

	it("updates fields and assignees, and pins", async () => {
		const item = await makeHabit(h.adult);
		const res = await h.adult.api.patch(`/items/${item.id}`, {
			name: "Water",
			reward: 7,
			pinned: true,
			assigneeIds: [h.kid.userId],
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ name: "Water", reward: 7, pinned: true, assigneeIds: [h.kid.userId] });
	});

	it("a child cannot update an item they did not create", async () => {
		const item = await makeHabit(h.adult, { assigneeIds: [h.kid.userId] });
		expect((await h.kid.api.patch(`/items/${item.id}`, { name: "Hacked" })).statusCode).toBe(403);
	});

	it("archive (DELETE): disappears from the list, comes back with includeArchived, and stays idempotent", async () => {
		const item = await makeHabit(h.owner);
		expect((await h.owner.api.del(`/items/${item.id}`)).statusCode).toBe(204);
		expect((await h.owner.api.del(`/items/${item.id}`)).statusCode).toBe(204);
		expect((await h.owner.api.get("/items")).json().items).toHaveLength(0);
		const all = (await h.owner.api.get("/items?includeArchived=true")).json().items;
		expect(all).toHaveLength(1);
		expect(all[0].archivedAt).not.toBeNull();
	});

	it("404 on an unknown item", async () => {
		expect((await h.owner.api.patch("/items/inconnu", { name: "x" })).statusCode).toBe(404);
	});
});
