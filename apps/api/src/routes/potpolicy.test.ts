// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { balances, createHousehold, createTestContext, type TestContext } from "../test/helpers.js";

let ctx: TestContext;
let h: Awaited<ReturnType<typeof createHousehold>>;
beforeEach(async () => {
	ctx = await createTestContext();
	h = await createHousehold(ctx);
	// 10 coins in the pot, given by alice.
	await h.owner.api.post("/ledger/adjustments", { userId: h.owner.userId, amount: 10, note: "seed" });
	await h.owner.api.post("/transfers", { amount: 10 });
});
afterEach(async () => {
	await ctx.close();
});

const policy = (value: string) => h.owner.api.patch("/household", { potWithdrawals: value });

describe("the pot withdrawal policy", () => {
	it("is owners-only by default, and only an owner changes it", async () => {
		expect((await h.owner.api.get("/household")).json().household.potWithdrawals).toBe("owners");
		expect((await h.adult.api.patch("/household", { potWithdrawals: "members" })).statusCode).toBe(403);
		expect((await policy("everybody")).statusCode).toBe(400);
		expect((await policy("members")).json().household.potWithdrawals).toBe("members");
		expect((await h.kid.api.get("/household")).json().household.potWithdrawals).toBe("members");
	});

	it("owners: only owners take coins out, into their own wallet", async () => {
		const member = await h.adult.api.post("/household/pot/withdrawals", { amount: 3 });
		expect(member.statusCode).toBe(403);
		expect(member.json().code).toBe("pot_locked");
		const owner = await h.owner.api.post("/household/pot/withdrawals", { amount: 3 });
		expect(owner.statusCode).toBe(201);
		expect(await balances(h.owner)).toEqual({ personal: 3, shared: 7 });
	});

	it("members: every unsupervised member withdraws, a supervised one never", async () => {
		await policy("members");
		expect((await h.adult.api.post("/household/pot/withdrawals", { amount: 4 })).statusCode).toBe(201);
		expect(await balances(h.adult)).toEqual({ personal: 4, shared: 6 });
		const ward = await h.kid.api.post("/household/pot/withdrawals", { amount: 1 });
		expect(ward.json().code).toBe("pot_locked");
	});

	it("nobody: not even an owner, and shared wishes cannot be paid", async () => {
		await policy("nobody");
		expect((await h.owner.api.post("/household/pot/withdrawals", { amount: 1 })).json().code).toBe("pot_locked");
		const wish = (await h.owner.api.post("/rewards", { name: "Cinema", cost: 2, fundedFrom: "shared" })).json();
		expect((await h.owner.api.post(`/rewards/${wish.id}/redemptions`)).json().code).toBe("pot_locked");
		expect((await balances(h.owner)).shared).toBe(10);
	});

	it("the policy also governs paying a shared wish", async () => {
		const wish = (await h.owner.api.post("/rewards", { name: "Cinema", cost: 2, fundedFrom: "shared" })).json();
		expect((await h.adult.api.post(`/rewards/${wish.id}/redemptions`)).json().code).toBe("pot_locked");
		await policy("members");
		expect((await h.adult.api.post(`/rewards/${wish.id}/redemptions`)).statusCode).toBe(201);
		expect((await balances(h.owner)).shared).toBe(8);
	});

	it("never more than the pot holds, and the ledger stays balanced", async () => {
		const res = await h.owner.api.post("/household/pot/withdrawals", { amount: 11 });
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("insufficient_balance");
		expect((await h.owner.api.post("/household/pot/withdrawals", { amount: 0 })).statusCode).toBe(400);
		await h.owner.api.post("/household/pot/withdrawals", { amount: 10 });
		expect(await balances(h.owner)).toEqual({ personal: 10, shared: 0 });
	});

	it("a guardian cannot withdraw on a ward's behalf", async () => {
		await policy("members");
		const url = `/supervision/wards/${h.kid.userId}/household/pot/withdrawals`;
		expect((await h.owner.api.post(url, { amount: 1 })).statusCode).toBe(404);
	});
});

describe("paying a member out of the pot", () => {
	it("is for owners, goes to a member's wallet, never to yourself", async () => {
		const ok = await h.owner.api.post("/household/pot/payouts", { userId: h.adult.userId, amount: 4 });
		expect(ok.statusCode).toBe(201);
		expect(await balances(h.adult)).toEqual({ personal: 4, shared: 6 });
		// The pot of a locked household can still be paid out by an owner: it is the owner's decision.
		await policy("nobody");
		expect((await h.owner.api.post("/household/pot/payouts", { userId: h.kid.userId, amount: 2 })).statusCode).toBe(
			201,
		);
		expect((await h.owner.api.post("/household/pot/payouts", { userId: h.owner.userId, amount: 1 })).statusCode).toBe(
			400,
		);
		expect((await h.adult.api.post("/household/pot/payouts", { userId: h.kid.userId, amount: 1 })).statusCode).toBe(
			403,
		);
		expect((await h.owner.api.post("/household/pot/payouts", { userId: "nobody-here", amount: 1 })).statusCode).toBe(
			400,
		);
		expect((await h.owner.api.post("/household/pot/payouts", { userId: h.adult.userId, amount: 99 })).json().code).toBe(
			"insufficient_balance",
		);
	});
});
