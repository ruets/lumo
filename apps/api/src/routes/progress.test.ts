// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const day = (iso: string) => {
	ctx.clock.now = new Date(`${iso}T10:00:00Z`);
};

describe("GET /today", () => {
	it("liste ce qui est dû ce jour, avec l'avancement et l'objectif", async () => {
		const water = await makeHabit(h.owner, { name: "Eau", targetPerPeriod: 3, reward: 1 });
		await makeHabit(h.owner, { name: "Sport", schedule: { type: "weekly", days: [1] } }); // lundi : pas dû mardi
		await h.owner.api.post(`/items/${water.id}/completions`);
		await h.owner.api.post(`/items/${water.id}/completions`);

		const res = (await h.owner.api.get("/today")).json();
		expect(res.date).toBe("2026-11-17");
		expect(res.items).toHaveLength(1);
		expect(res.items[0]).toMatchObject({
			item: { id: water.id, name: "Eau" },
			approved: 2,
			pending: 0,
			target: 3,
			done: false,
		});

		await h.owner.api.post(`/items/${water.id}/completions`);
		expect((await h.owner.api.get("/today")).json().items[0]).toMatchObject({ approved: 3, done: true });
	});

	it("accepte une date, épingle en premier, et n'affiche que mes éléments", async () => {
		await makeHabit(h.owner, { name: "B" });
		await makeHabit(h.owner, { name: "A épinglée", pinned: true });
		await makeHabit(h.adult, { name: "À Bob" });
		const names = (await h.owner.api.get("/today?date=2026-11-16"))
			.json()
			.items.map((i: { item: { name: string } }) => i.item.name);
		expect(names).toEqual(["A épinglée", "B"]);
	});

	it("tâche : visible tant qu'elle n'est pas faite, puis seulement le jour où elle l'a été", async () => {
		const task = (await h.owner.api.post("/items", { kind: "task", name: "Colis", reward: 2 })).json();
		expect((await h.owner.api.get("/today")).json().items).toHaveLength(1);
		await h.owner.api.post(`/items/${task.id}/completions`);
		expect((await h.owner.api.get("/today")).json().items[0]).toMatchObject({ approved: 1, done: true });
		day("2026-11-18");
		expect((await h.owner.api.get("/today")).json().items).toHaveLength(0);
	});

	it("compte les validations en attente séparément", async () => {
		const item = await makeHabit(h.adult, { requiresApproval: true, assigneeIds: [h.kid.userId] });
		await h.kid.api.post(`/items/${item.id}/completions`);
		expect((await h.kid.api.get("/today")).json().items[0]).toMatchObject({ approved: 0, pending: 1, done: false });
	});

	it("refuse une date mal formée", async () => {
		expect((await h.owner.api.get("/today?date=hier")).statusCode).toBe(400);
	});
});

describe("GET /stats", () => {
	async function complete(itemId: string, date: string) {
		day(date);
		return h.owner.api.post(`/items/${itemId}/completions`);
	}

	it("série actuelle, record, taux semaine et mois, heatmap", async () => {
		day("2026-11-10");
		const item = await makeHabit(h.owner);
		for (const d of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-14", "2026-11-15", "2026-11-16"]) {
			expect((await complete(item.id, d)).statusCode).toBe(201);
		}
		day("2026-11-17");

		const stats = (await h.owner.api.get("/stats")).json();
		expect(stats.to).toBe("2026-11-17");
		const habit = stats.habits[0];
		expect(habit).toMatchObject({ itemId: item.id, streak: { current: 3, best: 3 } });
		// 7 derniers jours (11→17) : 11,12,14,15,16 faits sur 6 jours échus (le 17 est en cours)
		expect(habit.week).toEqual({ done: 5, expected: 6, rate: 5 / 6 });
		const heat = Object.fromEntries(stats.heatmap.map((c: { date: string; done: number }) => [c.date, c.done]));
		expect(heat["2026-11-12"]).toBe(1);
		expect(heat["2026-11-13"]).toBe(0);
	});

	it("l'annulation retire la validation des séries", async () => {
		day("2026-11-16");
		const item = await makeHabit(h.owner);
		const done = (await complete(item.id, "2026-11-16")).json().completion;
		await h.owner.api.del(`/completions/${done.id}`);
		day("2026-11-17");
		expect((await h.owner.api.get("/stats")).json().habits[0].streak).toEqual({ current: 0, best: 0 });
	});

	it("une validation en attente ne compte pas tant qu'elle n'est pas approuvée", async () => {
		const item = await makeHabit(h.adult, { requiresApproval: true, assigneeIds: [h.kid.userId] });
		const pending = (await h.kid.api.post(`/items/${item.id}/completions`)).json().completion;
		expect((await h.kid.api.get("/stats")).json().habits[0].streak.current).toBe(0);
		await h.adult.api.post(`/completions/${pending.id}/approve`);
		expect((await h.kid.api.get("/stats")).json().habits[0].streak.current).toBe(1);
	});

	it("n'expose que mes habitudes", async () => {
		await makeHabit(h.adult);
		expect((await h.owner.api.get("/stats")).json().habits).toEqual([]);
	});

	it("valide la plage", async () => {
		expect((await h.owner.api.get("/stats?from=2026-11-17&to=2026-11-01")).statusCode).toBe(400);
		expect((await h.owner.api.get("/stats?from=2020-01-01&to=2026-11-01")).statusCode).toBe(400);
	});
});
