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

describe("création", () => {
	it("une habitude quotidienne, assignée à son créateur par défaut", async () => {
		const res = await h.owner.api.post("/items", {
			kind: "habit",
			name: "Boire de l'eau",
			schedule: { type: "daily" },
			targetPerPeriod: 3,
			reward: 2,
			pinned: true,
		});
		expect(res.statusCode).toBe(201);
		expect(res.json()).toMatchObject({
			kind: "habit",
			name: "Boire de l'eau",
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

	it("une tâche ponctuelle avec échéance : objectif forcé à 1, pas de récurrence", async () => {
		const res = await h.owner.api.post("/items", {
			kind: "task",
			name: "Appeler le plombier",
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

	it("refuse une habitude sans récurrence, une récurrence invalide, une récompense négative", async () => {
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

	it("exige une Idempotency-Key sur les écritures", async () => {
		const res = await h.owner.api.post("/items", { kind: "task", name: "x" }, { "idempotency-key": "" });
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("idempotency_key_required");
	});

	it("un adulte crée pour un enfant (assignation, élément partagé entre membres)", async () => {
		const item = await makeHabit(h.adult, { assigneeIds: [h.kid.userId, h.adult.userId] });
		expect(item.assigneeIds.sort()).toEqual([h.kid.userId, h.adult.userId].sort());
	});

	it("refuse d'assigner quelqu'un qui n'est pas membre du foyer", async () => {
		const res = await h.owner.api.post("/items", { kind: "task", name: "x", assigneeIds: ["inconnu"] });
		expect(res.statusCode).toBe(400);
	});
});

describe("droits de création", () => {
	it("un enfant ne crée rien par défaut", async () => {
		const res = await h.kid.api.post("/items", { kind: "task", name: "Ranger" });
		expect(res.statusCode).toBe(403);
		expect(res.json().code).toBe("forbidden");
	});

	it("un enfant autorisé crée pour lui seulement", async () => {
		ctx.db.update(memberships).set({ canCreateItems: true }).where(eq(memberships.userId, h.kid.userId)).run();
		expect((await h.kid.api.post("/items", { kind: "task", name: "Ranger" })).statusCode).toBe(201);
		const forOther = await h.kid.api.post("/items", { kind: "task", name: "Ranger", assigneeIds: [h.adult.userId] });
		expect(forOther.statusCode).toBe(403);
	});
});

describe("lecture, modification, archivage", () => {
	it("un enfant ne voit que ce qui lui est assigné ou qu'il a créé ; un adulte voit tout", async () => {
		const mine = await makeHabit(h.adult, { name: "Pour l'enfant", assigneeIds: [h.kid.userId] });
		await makeHabit(h.adult, { name: "Pour l'adulte" });
		const kidItems = (await h.kid.api.get("/items")).json().items;
		expect(kidItems.map((i: { id: string }) => i.id)).toEqual([mine.id]);
		expect((await h.adult.api.get("/items")).json().items).toHaveLength(2);
	});

	it("modifie les champs, les assignés et épingle", async () => {
		const item = await makeHabit(h.adult);
		const res = await h.adult.api.patch(`/items/${item.id}`, {
			name: "Eau",
			reward: 7,
			pinned: true,
			assigneeIds: [h.kid.userId],
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ name: "Eau", reward: 7, pinned: true, assigneeIds: [h.kid.userId] });
	});

	it("un enfant ne modifie pas un élément qu'il n'a pas créé", async () => {
		const item = await makeHabit(h.adult, { assigneeIds: [h.kid.userId] });
		expect((await h.kid.api.patch(`/items/${item.id}`, { name: "Piraté" })).statusCode).toBe(403);
	});

	it("archive (DELETE) : disparaît de la liste, réapparaît avec includeArchived, et reste idempotent", async () => {
		const item = await makeHabit(h.owner);
		expect((await h.owner.api.del(`/items/${item.id}`)).statusCode).toBe(204);
		expect((await h.owner.api.del(`/items/${item.id}`)).statusCode).toBe(204);
		expect((await h.owner.api.get("/items")).json().items).toHaveLength(0);
		const all = (await h.owner.api.get("/items?includeArchived=true")).json().items;
		expect(all).toHaveLength(1);
		expect(all[0].archivedAt).not.toBeNull();
	});

	it("404 sur un élément inconnu", async () => {
		expect((await h.owner.api.patch("/items/inconnu", { name: "x" })).statusCode).toBe(404);
	});
});
