// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ledgerEntries, redemptions } from "../db/schema.js";
import {
	type Api,
	balances,
	createHousehold,
	createTestContext,
	makeHabit,
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

const complete = (who: { api: Api }, itemId: string, body: object = {}) =>
	who.api.post(`/items/${itemId}/completions`, body);

describe("complete: coins are computed by the server, in the same transaction", () => {
	it("credits the reward to the personal wallet and writes to the ledger", async () => {
		const item = await makeHabit(h.owner, { reward: 5 });
		const res = await complete(h.owner, item.id);
		expect(res.statusCode).toBe(201);
		expect(res.json().completion).toMatchObject({
			itemId: item.id,
			userId: h.owner.userId,
			localDate: "2026-11-17",
			status: "approved",
		});
		expect(res.json().balances).toEqual({ personal: 5, shared: 0 });

		const entries = ctx.db.select().from(ledgerEntries).all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			amount: 5,
			reason: "completion",
			refId: res.json().completion.id,
			createdBy: h.owner.userId,
		});
		expect(await balances(h.owner)).toEqual({ personal: 5, shared: 0 });
	});

	it("the history names the habit, the undo and the redeemed wish", async () => {
		const item = await makeHabit(h.owner, { name: "Read", reward: 5 });
		const done = await complete(h.owner, item.id);
		await h.owner.api.del(`/completions/${done.json().completion.id}`);
		await complete(h.owner, item.id);
		const reward = (await h.owner.api.post("/rewards", { name: "Cinema", cost: 3 })).json();
		await h.owner.api.post(`/rewards/${reward.id}/redemptions`);
		const labels = (await h.owner.api.get("/ledger")).json().entries.map((e: { label: string | null }) => e.label);
		// Frozen clock: the order between simultaneous entries is undefined, so we compare without order.
		expect([...labels].sort()).toEqual(["Cinema", "Read", "Read", "Read"]);
	});

	it("rejects any amount sent by the client", async () => {
		const item = await makeHabit(h.owner, { reward: 5 });
		const res = await complete(h.owner, item.id, { amount: 1000 });
		expect(res.statusCode).toBe(400);
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
	});

	it("credits the pot when the item asks for it", async () => {
		const item = await makeHabit(h.owner, { reward: 3, creditsTo: "shared" });
		await complete(h.owner, item.id);
		expect(await balances(h.owner)).toEqual({ personal: 0, shared: 3 });
		// the pot is visible to the whole household
		expect((await balances(h.kid)).shared).toBe(3);
	});

	it("daily goal: 3 completions each pay, the 4th is rejected (409 target_reached)", async () => {
		const item = await makeHabit(h.owner, { reward: 2, targetPerPeriod: 3 });
		for (let i = 0; i < 3; i++) expect((await complete(h.owner, item.id)).statusCode).toBe(201);
		const fourth = await complete(h.owner, item.id);
		expect(fourth.statusCode).toBe(409);
		expect(fourth.json().code).toBe("target_reached");
		expect((await balances(h.owner)).personal).toBe(6);
	});

	it("a zero reward completes without an entry", async () => {
		const item = await makeHabit(h.owner, { reward: 0 });
		expect((await complete(h.owner, item.id)).statusCode).toBe(201);
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
	});

	it("you only complete your own items", async () => {
		const forKid = await makeHabit(h.adult, { assigneeIds: [h.kid.userId] });
		const res = await complete(h.owner, forKid.id);
		expect(res.statusCode).toBe(403);
		expect((await complete(h.kid, forKid.id)).statusCode).toBe(201);
	});

	it("an archived or unknown item cannot be completed", async () => {
		const item = await makeHabit(h.owner);
		await h.owner.api.del(`/items/${item.id}`);
		expect((await complete(h.owner, item.id)).statusCode).toBe(404);
		expect((await complete(h.owner, "inconnu")).statusCode).toBe(404);
	});

	it("fixed-day habit: rejected on a non-due day (409 not_due)", async () => {
		const item = await makeHabit(h.owner, { schedule: { type: "weekly", days: [1, 3, 5] } }); // Tuesday the 17th: not due
		const res = await complete(h.owner, item.id);
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("not_due");
	});

	it("one-off task: a single completion, whatever the date", async () => {
		const task = await h.owner.api.post("/items", { kind: "task", name: "Post the parcel", reward: 4 });
		expect((await complete(h.owner, task.json().id)).statusCode).toBe(201);
		expect((await complete(h.owner, task.json().id, { date: "2026-11-16" })).json().code).toBe("target_reached");
	});

	it("the day is the person's (Europe/Paris time zone here), not UTC", async () => {
		ctx.clock.now = new Date("2026-11-17T23:30:00Z"); // 00:30 on the 18th in Paris
		const item = await makeHabit(h.owner);
		expect((await complete(h.owner, item.id)).json().completion.localDate).toBe("2026-11-18");
	});
});

describe("past days", () => {
	it("yesterday and the day before pass for everyone (default window: 2 days)", async () => {
		const item = await makeHabit(h.adult);
		expect((await complete(h.adult, item.id, { date: "2026-11-16" })).statusCode).toBe(201);
		expect((await complete(h.adult, item.id, { date: "2026-11-15" })).statusCode).toBe(201);
	});

	it("beyond the window: rejected for an adult, allowed for an owner", async () => {
		const mine = await makeHabit(h.adult);
		const res = await complete(h.adult, mine.id, { date: "2026-11-10" });
		expect(res.statusCode).toBe(403);
		expect(res.json().code).toBe("backdate_not_allowed");

		const ownerItem = await makeHabit(h.owner);
		expect((await complete(h.owner, ownerItem.id, { date: "2026-11-10" })).statusCode).toBe(201);
	});

	it("never in the future", async () => {
		const item = await makeHabit(h.owner);
		const res = await complete(h.owner, item.id, { date: "2026-11-18" });
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("future_date");
	});
});

describe("undo", () => {
	it("sets undone_at and writes a counter-entry (the ledger is never modified)", async () => {
		const item = await makeHabit(h.owner, { reward: 5 });
		const done = (await complete(h.owner, item.id)).json().completion;
		const res = await h.owner.api.del(`/completions/${done.id}`);
		expect(res.statusCode).toBe(200);
		expect(res.json().completion.undoneAt).not.toBeNull();
		expect(res.json().balances.personal).toBe(0);
		const entries = ctx.db.select().from(ledgerEntries).all();
		expect(entries.map((e) => [e.amount, e.reason]).sort()).toEqual([
			[-5, "undo"],
			[5, "completion"],
		]);
	});

	it("frees the slot: you can complete again after an undo", async () => {
		const item = await makeHabit(h.owner, { reward: 5 });
		const done = (await complete(h.owner, item.id)).json().completion;
		await h.owner.api.del(`/completions/${done.id}`);
		expect((await complete(h.owner, item.id)).statusCode).toBe(201);
		expect((await balances(h.owner)).personal).toBe(5);
	});

	it("refunds the exact amount paid, even if the reward changed since", async () => {
		const item = await makeHabit(h.owner, { reward: 5 });
		const done = (await complete(h.owner, item.id)).json().completion;
		await h.owner.api.patch(`/items/${item.id}`, { reward: 50 });
		await h.owner.api.del(`/completions/${done.id}`);
		expect((await balances(h.owner)).personal).toBe(0);
	});

	it("two undos: the second is rejected (409)", async () => {
		const item = await makeHabit(h.owner);
		const done = (await complete(h.owner, item.id)).json().completion;
		await h.owner.api.del(`/completions/${done.id}`);
		const again = await h.owner.api.del(`/completions/${done.id}`);
		expect(again.statusCode).toBe(409);
		expect(again.json().code).toBe("already_undone");
	});

	it("rights: you undo your own; an owner undoes anybody's; another member cannot", async () => {
		const adultItem = await makeHabit(h.adult);
		const adultDone = (await complete(h.adult, adultItem.id)).json().completion;
		expect((await h.kid.api.del(`/completions/${adultDone.id}`)).statusCode).toBe(403);
		expect((await h.owner.api.del(`/completions/${adultDone.id}`)).statusCode).toBe(200);

		const kidItem = await makeHabit(h.adult, { assigneeIds: [h.kid.userId] });
		const kidDone = (await complete(h.kid, kidItem.id)).json().completion;
		expect((await h.adult.api.del(`/completions/${kidDone.id}`)).statusCode).toBe(403);
	});
});

describe("guardian approval", () => {
	let item: { id: string };
	const ward = () => `/supervision/wards/${h.kid.userId}`;
	beforeEach(async () => {
		item = await makeHabit(h.adult, { reward: 5, requiresApproval: true, assigneeIds: [h.kid.userId, h.adult.userId] });
	});

	it("a supervised account: pending completion, no entry, no balance", async () => {
		const res = await complete(h.kid, item.id);
		expect(res.json().completion.status).toBe("pending");
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
		expect(await balances(h.kid)).toEqual({ personal: 0, shared: 0 });
	});

	it("an unsupervised member on the same item is credited right away", async () => {
		expect((await complete(h.adult, item.id)).json().completion.status).toBe("approved");
		expect((await balances(h.adult)).personal).toBe(5);
	});

	it("waiting counts toward the goal: no double submission", async () => {
		await complete(h.kid, item.id);
		expect((await complete(h.kid, item.id)).json().code).toBe("target_reached");
	});

	it("approving creates the entry in the ward's wallet", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		const res = await h.owner.api.post(`${ward()}/completions/${pending.id}/approve`);
		expect(res.statusCode).toBe(200);
		expect(res.json().completion).toMatchObject({ status: "approved", approvedBy: h.owner.userId });
		expect(await balances(h.kid)).toEqual({ personal: 5, shared: 0 });
		const [entry] = ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.refId, pending.id)).all();
		expect(entry).toMatchObject({ amount: 5, reason: "completion", createdBy: h.owner.userId });
	});

	it("rejecting credits nothing", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		const res = await h.owner.api.post(`${ward()}/completions/${pending.id}/reject`);
		expect(res.json().completion.status).toBe("rejected");
		expect(await balances(h.kid)).toEqual({ personal: 0, shared: 0 });
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
	});

	it("approving twice is rejected (409 not_pending), no double credit", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		await h.owner.api.post(`${ward()}/completions/${pending.id}/approve`);
		const again = await h.owner.api.post(`${ward()}/completions/${pending.id}/approve`);
		expect(again.statusCode).toBe(409);
		expect(again.json().code).toBe("not_pending");
		expect((await balances(h.kid)).personal).toBe(5);
	});

	it("only a guardian approves: not the ward, not another member", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		for (const who of [h.kid, h.adult]) {
			expect((await who.api.post(`${ward()}/completions/${pending.id}/approve`)).statusCode).toBe(404);
		}
		expect((await h.kid.api.post(`/completions/${pending.id}/approve`)).statusCode).toBe(404); // no household route any more
	});

	it("pending completions are listed for the guardian, across all their wards", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		const list = (await h.owner.api.get("/supervision/pending")).json().completions;
		expect(list).toEqual([
			expect.objectContaining({ id: pending.id, wardId: h.kid.userId, wardName: "kid", itemName: "Drink water" }),
		]);
		expect((await h.adult.api.get("/supervision/pending")).json().completions).toEqual([]);
	});

	it("undoing a pending completion does not touch the ledger", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		expect((await h.kid.api.del(`/completions/${pending.id}`)).statusCode).toBe(200);
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
	});
});

describe("idempotency", () => {
	it("a duplicate (same key) returns the same response without a second credit", async () => {
		const item = await makeHabit(h.owner, { reward: 5 });
		const key = { "idempotency-key": "11111111-1111-4111-8111-111111111111" };
		const first = await h.owner.api.post(`/items/${item.id}/completions`, {}, key);
		const second = await h.owner.api.post(`/items/${item.id}/completions`, {}, key);
		expect(first.statusCode).toBe(201);
		expect(second.statusCode).toBe(201);
		expect(second.json()).toEqual(first.json());
		expect(second.headers["idempotent-replayed"]).toBe("true");
		expect(first.headers["idempotent-replayed"]).toBeUndefined();
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(1);
	});

	it("an error is not stored: you can retry with the same key", async () => {
		const item = await makeHabit(h.owner, { reward: 5, schedule: { type: "weekly", days: [1] } });
		const key = { "idempotency-key": "22222222-2222-4222-8222-222222222222" };
		expect((await h.owner.api.post(`/items/${item.id}/completions`, {}, key)).statusCode).toBe(409);
		ctx.clock.now = new Date("2026-11-16T10:00:00Z"); // Monday: becomes due
		expect((await h.owner.api.post(`/items/${item.id}/completions`, {}, key)).statusCode).toBe(201);
	});

	it("the key is specific to each user", async () => {
		const mine = await makeHabit(h.owner, { assigneeIds: [h.owner.userId, h.adult.userId] });
		const key = { "idempotency-key": "33333333-3333-4333-8333-333333333333" };
		expect((await h.owner.api.post(`/items/${mine.id}/completions`, {}, key)).statusCode).toBe(201);
		const other = await h.adult.api.post(`/items/${mine.id}/completions`, {}, key);
		expect(other.statusCode).toBe(201);
		expect(other.headers["idempotent-replayed"]).toBeUndefined();
	});
});

describe("personal → pot transfers", () => {
	beforeEach(async () => {
		await complete(h.kid, (await makeHabit(h.adult, { reward: 5, assigneeIds: [h.kid.userId] })).id);
	});

	it("two opposite entries linked by the same transfer_id, in the same transaction", async () => {
		const res = await h.kid.api.post("/transfers", { amount: 3 });
		expect(res.statusCode).toBe(201);
		expect(res.json().balances).toEqual({ personal: 2, shared: 3 });
		const entries = ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.reason, "transfer")).all();
		expect(entries).toHaveLength(2);
		expect(entries.map((e) => e.amount).sort()).toEqual([-3, 3]);
		expect(new Set(entries.map((e) => e.transferId)).size).toBe(1);
		expect(entries[0]?.transferId).toBe(res.json().transferId);
	});

	it("insufficient balance: 409, nothing is written", async () => {
		const res = await h.kid.api.post("/transfers", { amount: 6 });
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("insufficient_balance");
		expect(ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.reason, "transfer")).all()).toHaveLength(0);
	});

	it("allows transferring everything; rejects 0, negative, decimal", async () => {
		expect((await h.kid.api.post("/transfers", { amount: 5 })).statusCode).toBe(201);
		for (const amount of [0, -2, 1.5]) {
			expect((await h.kid.api.post("/transfers", { amount })).statusCode).toBe(400);
		}
	});
});

describe("wishes and redemptions", () => {
	const makeReward = (by: { api: Api }, over: object = {}) =>
		by.api.post("/rewards", { name: "Cinema", cost: 4, fundedFrom: "personal", ...over });

	beforeEach(async () => {
		const item = await makeHabit(h.adult, { reward: 5, assigneeIds: [h.kid.userId] });
		await complete(h.kid, item.id);
	});

	it("only owner and adults create wishes", async () => {
		expect((await makeReward(h.kid)).statusCode).toBe(403);
		const res = await makeReward(h.adult, { description: "Movie night", link: "https://example.org/film" });
		expect(res.statusCode).toBe(201);
		expect(res.json()).toMatchObject({
			name: "Cinema",
			cost: 4,
			fundedFrom: "personal",
			limitCount: null,
			assigneeIds: [],
		});
	});

	it("requires a price of at least 1 coin and a consistent limit", async () => {
		expect((await makeReward(h.adult, { cost: 0 })).statusCode).toBe(400);
		expect((await makeReward(h.adult, { limitCount: 2 })).statusCode).toBe(400);
		expect((await makeReward(h.adult, { limitCount: 2, limitPeriod: "week" })).statusCode).toBe(201);
	});

	it("redeeming debits the price and records the redemption with its entry", async () => {
		const reward = (await makeReward(h.adult)).json();
		const res = await h.kid.api.post(`/rewards/${reward.id}/redemptions`);
		expect(res.statusCode).toBe(201);
		expect(res.json().balances).toEqual({ personal: 1, shared: 0 });
		const [redemption] = ctx.db.select().from(redemptions).all();
		const entry = ctx.db
			.select()
			.from(ledgerEntries)
			.where(eq(ledgerEntries.id, redemption?.ledgerEntryId ?? ""))
			.get();
		expect(entry).toMatchObject({ amount: -4, reason: "redemption", refId: redemption?.id });
	});

	it("insufficient balance: 409 insufficient_balance", async () => {
		const reward = (await makeReward(h.adult, { cost: 6 })).json();
		const res = await h.kid.api.post(`/rewards/${reward.id}/redemptions`);
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("insufficient_balance");
	});

	it("per-period usage limit: 1 per week, then possible again the following week", async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: 20, note: "bonus" });
		const reward = (await makeReward(h.adult, { cost: 1, limitCount: 1, limitPeriod: "week" })).json();
		const remaining = async () =>
			(await h.kid.api.get("/rewards")).json().rewards.find((r: { id: string }) => r.id === reward.id).remaining;
		expect(await remaining()).toBe(1);
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(201);
		expect(await remaining()).toBe(0);
		const second = await h.kid.api.post(`/rewards/${reward.id}/redemptions`);
		expect(second.statusCode).toBe(409);
		expect(second.json().code).toBe("limit_reached");
		ctx.clock.now = new Date("2026-11-24T10:00:00Z"); // the following week
		expect(await remaining()).toBe(1);
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(201);
	});

	it("wish funded by the pot: owners by default, debits the pot", async () => {
		await h.kid.api.post("/transfers", { amount: 5 });
		const reward = (await makeReward(h.adult, { cost: 3, fundedFrom: "shared" })).json();
		const kid = await h.kid.api.post(`/rewards/${reward.id}/redemptions`);
		expect(kid.statusCode).toBe(403);
		expect(kid.json().code).toBe("pot_locked");
		expect((await h.adult.api.post(`/rewards/${reward.id}/redemptions`)).json().code).toBe("pot_locked");
		const res = await h.owner.api.post(`/rewards/${reward.id}/redemptions`);
		expect(res.statusCode).toBe(201);
		expect(res.json().balances.shared).toBe(2);
	});

	it("wish reserved for some members", async () => {
		const reward = (await makeReward(h.adult, { assigneeIds: [h.adult.userId] })).json();
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(403);
	});

	it("archived wish: no longer redeemable, and absent from the list", async () => {
		const reward = (await makeReward(h.adult)).json();
		await h.adult.api.patch(`/rewards/${reward.id}`, { archived: true });
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(404);
		expect((await h.kid.api.get("/rewards")).json().rewards).toHaveLength(0);
	});

	it("updating a wish: adults only", async () => {
		const reward = (await makeReward(h.adult)).json();
		expect((await h.kid.api.patch(`/rewards/${reward.id}`, { cost: 1 })).statusCode).toBe(403);
		expect((await h.adult.api.patch(`/rewards/${reward.id}`, { cost: 9 })).json().cost).toBe(9);
	});
});

describe("undoing a wish redemption", () => {
	const makeReward = (over: object = {}) =>
		h.adult.api.post("/rewards", { name: "Cinema", cost: 4, fundedFrom: "personal", ...over });
	const redeem = async (by: { api: Api }, rewardId: string) =>
		(await by.api.post(`/rewards/${rewardId}/redemptions`)).json().redemption.id as string;

	beforeEach(async () => {
		const item = await makeHabit(h.adult, { reward: 10, assigneeIds: [h.kid.userId] });
		await complete(h.kid, item.id);
	});

	it("refunds the exact amount by a counter-entry, without touching the existing ledger", async () => {
		const reward = (await makeReward()).json();
		const id = await redeem(h.kid, reward.id);
		expect(await balances(h.kid)).toEqual({ personal: 6, shared: 0 });
		const before = ctx.db.select().from(ledgerEntries).all();

		const res = await h.kid.api.del(`/redemptions/${id}`);
		expect(res.statusCode).toBe(200);
		expect(res.json().balances).toEqual({ personal: 10, shared: 0 });
		expect(res.json().redemption.undoneAt).not.toBeNull();

		const after = ctx.db.select().from(ledgerEntries).all();
		expect(after).toHaveLength(before.length + 1);
		expect(after.find((e) => e.reason === "undo")).toMatchObject({ amount: 4, refId: id, createdBy: h.kid.userId });
	});

	it("two simultaneous undos: a single refund", async () => {
		const reward = (await makeReward()).json();
		const id = await redeem(h.kid, reward.id);
		const [a, b] = await Promise.all([h.kid.api.del(`/redemptions/${id}`), h.kid.api.del(`/redemptions/${id}`)]);
		expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
		expect(await balances(h.kid)).toEqual({ personal: 10, shared: 0 });
	});

	it("refunds what was paid, even if the price changed since", async () => {
		const reward = (await makeReward()).json();
		const id = await redeem(h.kid, reward.id);
		await h.adult.api.patch(`/rewards/${reward.id}`, { cost: 9 });
		expect((await h.kid.api.del(`/redemptions/${id}`)).json().balances.personal).toBe(10);
	});

	it("a second undo is rejected (409), no double refund", async () => {
		const reward = (await makeReward()).json();
		const id = await redeem(h.kid, reward.id);
		await h.kid.api.del(`/redemptions/${id}`);
		const again = await h.kid.api.del(`/redemptions/${id}`);
		expect(again.statusCode).toBe(409);
		expect(again.json().code).toBe("already_undone");
		expect(await balances(h.kid)).toEqual({ personal: 10, shared: 0 });
	});

	it("frees the usage limit: you can redeem again", async () => {
		const reward = (await makeReward({ cost: 1, limitCount: 1, limitPeriod: "week" })).json();
		const id = await redeem(h.kid, reward.id);
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).json().code).toBe("limit_reached");
		await h.kid.api.del(`/redemptions/${id}`);
		const listed = (await h.kid.api.get("/rewards")).json().rewards.find((r: { id: string }) => r.id === reward.id);
		expect(listed.remaining).toBe(1);
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(201);
	});

	it("wish funded by the pot: refunds the pot", async () => {
		await h.kid.api.post("/transfers", { amount: 6 });
		const reward = (await makeReward({ cost: 5, fundedFrom: "shared" })).json();
		const id = await redeem(h.owner, reward.id);
		expect((await balances(h.owner)).shared).toBe(1);
		expect((await h.owner.api.del(`/redemptions/${id}`)).json().balances.shared).toBe(6);
	});

	it("rights: you undo your own; an owner undoes anybody's; another member cannot", async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: h.adult.userId, amount: 20, note: "test" });
		const cheap = (await makeReward({ cost: 1 })).json();
		const adults = await redeem(h.adult, cheap.id);
		expect((await h.kid.api.del(`/redemptions/${adults}`)).statusCode).toBe(403);
		expect((await h.owner.api.del(`/redemptions/${adults}`)).statusCode).toBe(200);
		const kids = await redeem(h.kid, cheap.id);
		expect((await h.adult.api.del(`/redemptions/${kids}`)).statusCode).toBe(403);
	});

	it("introuvable : 404", async () => {
		expect((await h.kid.api.del("/redemptions/inconnu")).statusCode).toBe(404);
	});

	it("the history names the wish on the refund line", async () => {
		const reward = (await makeReward({ name: "Ice cream" })).json();
		const id = await redeem(h.kid, reward.id);
		await h.kid.api.del(`/redemptions/${id}`);
		const entries = (await h.kid.api.get("/ledger")).json().entries;
		expect(entries.find((e: { reason: string }) => e.reason === "undo")).toMatchObject({
			label: "Ice cream",
			amount: 4,
		});
	});
});

describe("ledger and adjustments", () => {
	it("manual adjustment: owner only, note required, positive or negative", async () => {
		const ok = await h.owner.api.post("/ledger/adjustments", {
			userId: h.kid.userId,
			amount: 10,
			note: "Exceptional reward",
		});
		expect(ok.statusCode).toBe(201);
		expect(ok.json().entry).toMatchObject({
			amount: 10,
			reason: "adjustment",
			note: "Exceptional reward",
			createdBy: h.owner.userId,
		});
		expect((await balances(h.kid)).personal).toBe(10);

		expect(
			(await h.owner.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: -4, note: "Correction" }))
				.statusCode,
		).toBe(201);
		expect((await balances(h.kid)).personal).toBe(6);

		expect(
			(await h.adult.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: 1, note: "x" })).statusCode,
		).toBe(403);
		expect((await h.owner.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: 1 })).statusCode).toBe(400);
		expect(
			(await h.owner.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: 0, note: "x" })).statusCode,
		).toBe(400);
		expect(
			(await h.owner.api.post("/ledger/adjustments", { userId: "inconnu", amount: 1, note: "x" })).statusCode,
		).toBe(400);
	});

	it("adjusts the pot with a null userId", async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: null, amount: 7, note: "Don" });
		expect((await balances(h.kid)).shared).toBe(7);
	});

	it("cursor-paginated history, newest first, no duplicate or gap", async () => {
		for (let i = 1; i <= 5; i++) {
			ctx.clock.now = new Date(ctx.clock.now.getTime() + 1000);
			await h.owner.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: i, note: `n${i}` });
		}
		const seen: number[] = [];
		let cursor: string | null = null;
		let pages = 0;
		do {
			const res: { json(): { entries: { amount: number }[]; nextCursor: string | null; balance: number } } =
				await h.kid.api.get(`/ledger?wallet=personal&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
			const page = res.json();
			expect(page.balance).toBe(15);
			seen.push(...page.entries.map((e) => e.amount));
			cursor = page.nextCursor;
			pages++;
		} while (cursor);
		expect(seen).toEqual([5, 4, 3, 2, 1]);
		expect(pages).toBe(3);
	});

	it("everyone only reads their own wallet and the pot; the balance is the sum of the ledger", async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: 8, note: "a" });
		await h.owner.api.post("/ledger/adjustments", { userId: h.owner.userId, amount: 3, note: "b" });
		const mine = (await h.kid.api.get("/ledger?wallet=personal")).json();
		expect(mine.entries).toHaveLength(1);
		expect(mine.balance).toBe(8);
		expect((await h.kid.api.get("/ledger?wallet=shared")).json().entries).toHaveLength(0);
		expect((await h.kid.api.get("/ledger?wallet=autre")).statusCode).toBe(400);
	});
});
