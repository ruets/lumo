// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	balances,
	createHousehold,
	createTestContext,
	makeHabit,
	newLoneAccount,
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

const _PASSWORD = "a-long-password-here";

/** A local account with no household: someone invited by the super admin creates it themselves. */
async function loner(username: string) {
	const account = await newLoneAccount(ctx, h.owner, username);
	return { id: account.id, api: account.api };
}

describe("an account without a household", () => {
	it("creates, completes and tracks personal habits and earns personal coins", async () => {
		const zoe = await loner("zoe");
		const habit = await makeHabit(zoe, { reward: 4 });
		expect(habit).toMatchObject({ assigneeIds: [expect.any(String)] });

		const created = (await zoe.api.get("/items")).json().items;
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ scope: "personal", creditsTo: "personal" });

		const today = (await zoe.api.get("/today")).json();
		expect(today.items).toHaveLength(1);
		const done = await zoe.api.post(`/items/${habit.id}/completions`);
		expect(done.statusCode).toBe(201);
		expect(done.json().balances).toEqual({ personal: 4, shared: null });
		expect((await zoe.api.get("/stats")).statusCode).toBe(200);
		expect((await zoe.api.get("/ledger?wallet=personal")).json().balance).toBe(4);
	});

	it("has no pot: shared ledger, transfers and household routes answer no_household", async () => {
		const zoe = await loner("zoe");
		for (const call of [
			() => zoe.api.get("/ledger?wallet=shared"),
			() => zoe.api.post("/transfers", { amount: 1 }),
			() => zoe.api.get("/household"),
			() => zoe.api.post("/household/invites", { role: "member" }),
		]) {
			const res = await call();
			expect(res.statusCode).toBe(403);
			expect(res.json().code).toBe("no_household");
		}
		expect((await zoe.api.post("/items", { kind: "task", name: "x", scope: "household" })).json().code).toBe(
			"no_household",
		);
	});

	it("a personal item is yours alone: no other assignee, no pot, no approval", async () => {
		const zoe = await loner("zoe");
		const bad = [{ assigneeIds: [h.kid.userId] }, { creditsTo: "shared" }, { requiresApproval: true }];
		for (const over of bad) {
			const res = await zoe.api.post("/items", { kind: "habit", name: "x", schedule: { type: "daily" }, ...over });
			expect(res.statusCode).toBe(400);
		}
		// Not the wishes either.
		expect((await zoe.api.post("/rewards", { name: "Cinema", cost: 3, fundedFrom: "shared" })).statusCode).toBe(400);
		expect((await zoe.api.post("/rewards", { name: "Cinema", cost: 3, assigneeIds: [h.kid.userId] })).statusCode).toBe(
			400,
		);
	});

	it("redeems a personal wish with personal coins, and the balance can never go negative", async () => {
		const zoe = await loner("zoe");
		const reward = (await zoe.api.post("/rewards", { name: "Cinema", cost: 6 })).json();
		expect(reward).toMatchObject({ scope: "personal", fundedFrom: "personal" });
		expect((await zoe.api.post(`/rewards/${reward.id}/redemptions`)).json().code).toBe("insufficient_balance");

		const habit = await makeHabit(zoe, { reward: 10 });
		await zoe.api.post(`/items/${habit.id}/completions`);
		const redeemed = await zoe.api.post(`/rewards/${reward.id}/redemptions`);
		expect(redeemed.statusCode).toBe(201);
		expect(redeemed.json().balances.personal).toBe(4);
		const undone = await zoe.api.del(`/redemptions/${redeemed.json().redemption.id}`);
		expect(undone.json().balances.personal).toBe(10);
	});

	it("undoes a personal completion with a counter-entry", async () => {
		const zoe = await loner("zoe");
		const habit = await makeHabit(zoe, { reward: 5 });
		const done = (await zoe.api.post(`/items/${habit.id}/completions`)).json();
		const undone = await zoe.api.del(`/completions/${done.completion.id}`);
		expect(undone.statusCode).toBe(200);
		expect(undone.json().balances.personal).toBe(0);
	});
});

describe("personal items inside a household", () => {
	it("defaults to the household, and personal items are invisible to everybody else", async () => {
		const shared = await makeHabit(h.adult, { name: "Dishes", reward: 2 });
		const mine = await makeHabit(h.adult, { name: "Read", scope: "personal", reward: 3 });
		const adultItems = (await h.adult.api.get("/items")).json().items;
		expect(adultItems.map((i: { name: string; scope: string }) => [i.name, i.scope]).sort()).toEqual([
			["Dishes", "household"],
			["Read", "personal"],
		]);
		// The owner sees the household's items, not the adult's personal one.
		const ownerNames = (await h.owner.api.get("/items")).json().items.map((i: { name: string }) => i.name);
		expect(ownerNames).toEqual(["Dishes"]);
		expect((await h.owner.api.post(`/items/${mine.id}/completions`)).statusCode).toBe(404);
		expect((await h.owner.api.patch(`/items/${mine.id}`, { name: "Hacked" })).statusCode).toBe(404);
		expect((await h.owner.api.del(`/items/${mine.id}`)).statusCode).toBe(404);
		expect(shared.id).toBeTruthy();
	});

	it("personal coins go to the account's wallet and the pot stays untouched", async () => {
		const mine = await makeHabit(h.adult, { name: "Read", scope: "personal", reward: 3 });
		await h.adult.api.post(`/items/${mine.id}/completions`);
		expect(await balances(h.adult)).toEqual({ personal: 3, shared: 0 });
	});

	it("a child without the right to create items cannot create personal ones either", async () => {
		const res = await h.kid.api.post("/items", { kind: "task", name: "x", scope: "personal" });
		expect(res.statusCode).toBe(403);
	});

	it("personal wishes are private; household wishes are shared", async () => {
		const own = (await h.adult.api.post("/rewards", { name: "Book", cost: 2, scope: "personal" })).json();
		await h.adult.api.post("/rewards", { name: "Cinema", cost: 3 });
		expect((await h.owner.api.get("/rewards")).json().rewards.map((r: { name: string }) => r.name)).toEqual(["Cinema"]);
		expect((await h.owner.api.post(`/rewards/${own.id}/redemptions`)).statusCode).toBe(404);
	});

	it("leaving the household keeps personal items and coins", async () => {
		await h.owner.api.patch(`/supervision/wards/${h.kid.userId}/rights`, { canCreate: true });
		const own = await makeHabit(h.kid, { name: "Read", scope: "personal", reward: 3 });
		await h.kid.api.post(`/items/${own.id}/completions`);
		await h.owner.api.del(`/members/${h.kid.userId}`);

		const items = (await h.kid.api.get("/items")).json().items;
		expect(items.map((i: { name: string }) => i.name)).toEqual(["Read"]);
		expect((await h.kid.api.get("/me")).json().wallets.personal.balance).toBe(3);
	});
});
