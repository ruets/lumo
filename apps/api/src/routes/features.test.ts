// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const turnOff = (...features: string[]) =>
	h.owner.api.patch("/household", { features: Object.fromEntries(features.map((f) => [f, false])) });
const names = async (who: { api: typeof h.owner.api }, path: string, key: string) =>
	((await who.api.get(path)).json()[key] as { name: string }[]).map((x) => x.name).sort();

describe("household features", () => {
	it("are all on by default and only an owner changes them", async () => {
		expect((await h.adult.api.get("/household")).json().household.features).toEqual({
			pot: true,
			wishes: true,
			habits: true,
			tasks: true,
		});
		expect((await h.adult.api.patch("/household", { features: { pot: false } })).statusCode).toBe(403);
		const res = await turnOff("wishes");
		expect(res.json().household.features).toEqual({ pot: true, wishes: false, habits: true, tasks: true });
		expect((await h.owner.api.patch("/household", { features: { nope: false } })).statusCode).toBe(400);
	});

	it("habits off: household habits are hidden and cannot be created, tasks and personal habits stay", async () => {
		await makeHabit(h.owner, { name: "Shared habit" });
		await h.owner.api.post("/items", { kind: "task", name: "Shared task" });
		await makeHabit(h.owner, { name: "My habit", scope: "personal" });
		await turnOff("habits");

		expect(await names(h.owner, "/items", "items")).toEqual(["My habit", "Shared task"]);
		const refused = await h.owner.api.post("/items", { kind: "habit", name: "x", schedule: { type: "daily" } });
		expect(refused.statusCode).toBe(403);
		expect(refused.json().code).toBe("feature_disabled");
		// Personal habits have no toggles.
		expect(
			(await h.owner.api.post("/items", { kind: "habit", name: "y", schedule: { type: "daily" }, scope: "personal" }))
				.statusCode,
		).toBe(201);
	});

	it("tasks off: household tasks are hidden and cannot be created", async () => {
		await h.owner.api.post("/items", { kind: "task", name: "Shared task" });
		await turnOff("tasks");
		expect(await names(h.owner, "/items", "items")).toEqual([]);
		expect((await h.owner.api.post("/items", { kind: "task", name: "x" })).json().code).toBe("feature_disabled");
	});

	it("a hidden item cannot be completed, and comes back when the feature is switched on again", async () => {
		const item = await makeHabit(h.owner, { name: "Shared habit" });
		await turnOff("habits");
		expect((await h.owner.api.post(`/items/${item.id}/completions`)).statusCode).toBe(404);
		expect((await h.owner.api.get("/today")).json().items).toEqual([]);
		await h.owner.api.patch("/household", { features: { habits: true } });
		expect((await h.owner.api.post(`/items/${item.id}/completions`)).statusCode).toBe(201);
	});

	it("wishes off: household wishes are hidden, cannot be created or redeemed; personal wishes stay", async () => {
		const wish = (await h.owner.api.post("/rewards", { name: "Cinema", cost: 1 })).json();
		await h.owner.api.post("/rewards", { name: "Book", cost: 1, scope: "personal" });
		await turnOff("wishes");
		expect(await names(h.owner, "/rewards", "rewards")).toEqual(["Book"]);
		expect((await h.owner.api.post(`/rewards/${wish.id}/redemptions`)).statusCode).toBe(404);
		const refused = await h.owner.api.post("/rewards", { name: "x", cost: 1 });
		expect(refused.json().code).toBe("feature_disabled");
	});

	it("pot off: no pot anywhere, no transfers, withdrawals, payouts or shared-credit items", async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: h.owner.userId, amount: 10, note: "seed" });
		await turnOff("pot");
		const me = (await h.owner.api.get("/me")).json();
		expect(me.wallets.shared).toBeNull();
		expect(me.households[0].pot).toBeNull();
		for (const res of [
			await h.owner.api.post("/transfers", { amount: 1 }),
			await h.owner.api.post("/household/pot/withdrawals", { amount: 1 }),
			await h.owner.api.post("/household/pot/payouts", { userId: h.adult.userId, amount: 1 }),
			await h.owner.api.get("/ledger?wallet=shared"),
			await h.owner.api.post("/ledger/adjustments", { userId: null, amount: 1, note: "x" }),
			await h.owner.api.post("/items", { kind: "task", name: "x", reward: 2, creditsTo: "shared" }),
			await h.owner.api.post("/rewards", { name: "x", cost: 1, fundedFrom: "shared" }),
		]) {
			expect(res.statusCode).toBe(403);
			expect(res.json().code).toBe("feature_disabled");
		}
		expect((await balances(h.owner)).personal).toBe(10);
	});

	it("an item that already pays the pot cannot be completed while the pot is off", async () => {
		const item = await makeHabit(h.owner, { reward: 3, creditsTo: "shared" });
		await turnOff("pot");
		expect((await h.owner.api.post(`/items/${item.id}/completions`)).json().code).toBe("feature_disabled");
	});

	it("each household has its own toggles", async () => {
		const flat = (await h.owner.api.post("/households", { name: "Flat" })).json().householdId as string;
		await turnOff("habits"); // active household: The Smiths (oldest)
		await h.owner.api.post("/items", {
			kind: "habit",
			name: "Flat habit",
			schedule: { type: "daily" },
			scope: "household",
			householdId: flat,
		});
		expect(await names(h.owner, "/items", "items")).toEqual(["Flat habit"]);
		const inFlat = (await h.owner.api.get("/me", { "x-household-id": flat })).json();
		expect(inFlat.households.find((x: { id: string }) => x.id === flat).features.habits).toBe(true);
	});
});
