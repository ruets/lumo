// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completions, guardianships } from "../db/schema.js";
import {
	type api,
	balances,
	createHousehold,
	createTestContext,
	makeHabit,
	newLoneAccount,
	signUp,
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

type Who = { api: ReturnType<typeof api>; userId: string };

/** `guardian` supervises `ward`: the guardian makes a code, the ward uses it. */
async function supervise(guardian: Who, ward: Who) {
	const code = (await guardian.api.post("/supervision/codes", { kind: "supervise" })).json();
	const res = await ward.api.post("/supervision/redeem", { code: code.token });
	expect(res.statusCode).toBe(201);
}
const base = (ward: Who) => `/supervision/wards/${ward.userId}`;

describe("codes and consent", () => {
	it("a guardian's code makes whoever uses it their ward, with strict default rights", async () => {
		await supervise(h.owner, h.adult);
		const mine = (await h.adult.api.get("/supervision")).json();
		expect(mine.guardians).toEqual([{ id: h.owner.userId, displayName: "Alice" }]);
		expect(mine.rights).toEqual({ canCreate: false, canModify: false, canDelete: false, canTransfer: true });
		const theirs = (await h.owner.api.get("/supervision")).json();
		expect(theirs.wards.map((w: { id: string }) => w.id).sort()).toEqual([h.adult.userId, h.kid.userId].sort());
		expect(theirs.rights).toBeNull();
	});

	it("a ward's code makes whoever uses it their guardian", async () => {
		const code = (await h.adult.api.post("/supervision/codes", { kind: "be_supervised" })).json();
		expect((await h.owner.api.post("/supervision/redeem", { code: code.token })).statusCode).toBe(201);
		expect((await h.adult.api.get("/supervision")).json().guardians).toHaveLength(1);
		expect((await h.owner.api.get("/supervision")).json().wards).toHaveLength(2); // kid already was one
	});

	it("a code works once, expires, and cannot be used by its maker", async () => {
		const code = (await h.owner.api.post("/supervision/codes", { kind: "supervise" })).json();
		expect((await h.owner.api.post("/supervision/redeem", { code: code.token })).statusCode).toBe(409); // self
		expect((await h.adult.api.post("/supervision/redeem", { code: code.token })).statusCode).toBe(201);
		const again = await h.kid.api.post("/supervision/redeem", { code: code.token });
		expect(again.statusCode).toBe(400);
		expect(again.json().code).toBe("invalid_code");

		const old = (await h.owner.api.post("/supervision/codes", { kind: "supervise" })).json();
		ctx.clock.now = new Date("2026-12-30T10:00:00Z");
		expect((await h.kid.api.post("/supervision/redeem", { code: old.token })).json().code).toBe("invalid_code");
	});

	it("never twice, and no loops: a ward cannot supervise, nobody supervises their own guardian", async () => {
		await supervise(h.owner, h.adult);
		const dup = (await h.owner.api.post("/supervision/codes", { kind: "supervise" })).json();
		expect((await h.adult.api.post("/supervision/redeem", { code: dup.token })).json().code).toBe(
			"already_supervising",
		);
		// bob is supervised: he cannot supervise the kid …
		const bobCode = (await h.adult.api.post("/supervision/codes", { kind: "supervise" })).json();
		expect((await h.kid.api.post("/supervision/redeem", { code: bobCode.token })).json().code).toBe("guardian_cycle");
		// … and alice cannot be supervised by her own ward.
		const aliceCode = (await h.owner.api.post("/supervision/codes", { kind: "be_supervised" })).json();
		expect((await h.adult.api.post("/supervision/redeem", { code: aliceCode.token })).json().code).toBe(
			"guardian_cycle",
		);
	});

	it("a guardian's code also creates the account of a child who does not have one yet", async () => {
		const code = (await h.owner.api.post("/supervision/codes", { kind: "supervise" })).json();
		const lea = await signUp(ctx, code.token, "lea");
		expect(lea.status).toBe(201);
		const view = (await lea.api.get("/supervision")).json();
		expect(view.guardians).toEqual([expect.objectContaining({ id: h.owner.userId })]);
		expect(view.rights).toEqual({ canCreate: false, canModify: false, canDelete: false, canTransfer: true });
		expect((await lea.api.post("/items", { kind: "task", name: "x" })).json().code).toBe("supervised");
		// The code worked once.
		expect((await signUp(ctx, code.token, "lea2")).status).toBe(400);
		// A supervised account cannot invite supervised accounts of its own.
		const cycle = (await lea.api.post("/supervision/codes", { kind: "supervise" })).json();
		expect((await signUp(ctx, cycle.token, "lea3")).status).toBe(409);
	});
});

describe("what a ward may do by themselves", () => {
	it("is limited by the rights their guardians give", async () => {
		await supervise(h.owner, h.adult);
		const item = await makeHabit(h.owner, { assigneeIds: [h.adult.userId] });
		for (const res of [
			await h.adult.api.post("/items", { kind: "task", name: "x", scope: "personal" }),
			await h.adult.api.post("/rewards", { name: "Cinema", cost: 3, scope: "personal" }),
			await h.adult.api.patch(`/items/${item.id}`, { name: "renamed" }),
			await h.adult.api.del(`/items/${item.id}`),
		]) {
			expect(res.statusCode).toBe(403);
			expect(res.json().code).toBe("supervised");
		}
		// Completing is still theirs to do.
		expect((await h.adult.api.post(`/items/${item.id}/completions`)).statusCode).toBe(201);

		await h.owner.api.patch(`${base(h.adult)}/rights`, { canCreate: true });
		expect((await h.adult.api.post("/items", { kind: "task", name: "x", scope: "personal" })).statusCode).toBe(201);
		await h.owner.api.patch(`${base(h.adult)}/rights`, { canModify: true, canDelete: true });
		const own = (await h.adult.api.post("/items", { kind: "task", name: "y", scope: "personal" })).json();
		expect((await h.adult.api.patch(`/items/${own.id}`, { name: "z" })).statusCode).toBe(200);
		expect((await h.adult.api.del(`/items/${own.id}`)).statusCode).toBe(204);
	});

	it("giving to a pot can be withheld", async () => {
		await supervise(h.owner, h.adult);
		const habit = await makeHabit(h.adult, { reward: 4, scope: "personal" }).catch(() => null);
		expect(habit).toBeNull(); // cannot create while supervised
		await h.owner.api.patch(`${base(h.adult)}/rights`, { canCreate: true });
		const mine = await makeHabit(h.adult, { reward: 4, scope: "personal" });
		await h.adult.api.post(`/items/${mine.id}/completions`);
		expect((await h.adult.api.post("/transfers", { amount: 1 })).statusCode).toBe(201);
		await h.owner.api.patch(`${base(h.adult)}/rights`, { canTransfer: false });
		expect((await h.adult.api.post("/transfers", { amount: 1 })).json().code).toBe("supervised");
	});

	it("stops when the last guardian stops, and a ward cannot end it themselves", async () => {
		await supervise(h.owner, h.adult);
		expect((await h.adult.api.del(`/supervision/wards/${h.owner.userId}`)).statusCode).toBe(404);
		expect((await h.adult.api.post("/items", { kind: "task", name: "x", scope: "personal" })).statusCode).toBe(403);
		expect((await h.owner.api.del(base(h.adult))).statusCode).toBe(204);
		expect((await h.adult.api.get("/supervision")).json()).toMatchObject({ guardians: [], rights: null });
		expect((await h.adult.api.post("/items", { kind: "task", name: "x", scope: "personal" })).statusCode).toBe(201);
	});
});

describe("what a guardian can do for a ward", () => {
	it("sees and edits the ward's items and wishes, including personal ones", async () => {
		await supervise(h.owner, h.adult);
		await h.owner.api.patch(`${base(h.adult)}/rights`, { canCreate: true });
		const mine = await makeHabit(h.adult, { name: "Read", scope: "personal" });
		await h.owner.api.patch(`${base(h.adult)}/rights`, { canCreate: false });

		const list = (await h.owner.api.get(`${base(h.adult)}/items`)).json().items;
		expect(list.map((i: { name: string }) => i.name)).toContain("Read");
		// The household owner alone would not see it …
		expect((await h.owner.api.get("/items")).json().items.map((i: { name: string }) => i.name)).not.toContain("Read");
		// … but the guardian edits it for the ward, whatever the ward's own rights.
		expect((await h.owner.api.patch(`${base(h.adult)}/items/${mine.id}`, { name: "Read more" })).statusCode).toBe(200);
		const created = await h.owner.api.post(`${base(h.adult)}/items`, { kind: "task", name: "Tidy", scope: "personal" });
		expect(created.statusCode).toBe(201);
		const wish = await h.owner.api.post(`${base(h.adult)}/rewards`, { name: "Book", cost: 2, scope: "personal" });
		expect(wish.statusCode).toBe(201);
		expect((await h.adult.api.get("/rewards")).json().rewards.map((r: { name: string }) => r.name)).toContain("Book");
		expect((await h.owner.api.del(`${base(h.adult)}/items/${mine.id}`)).statusCode).toBe(204);
		expect((await h.owner.api.get(`${base(h.adult)}/me`)).json().user.displayName).toBe("bob");
		expect((await h.owner.api.get(`${base(h.adult)}/ledger`)).statusCode).toBe(200);
	});

	it("never completes or redeems for the ward", async () => {
		await supervise(h.owner, h.adult);
		const item = await makeHabit(h.owner, { assigneeIds: [h.adult.userId] });
		expect((await h.owner.api.post(`${base(h.adult)}/items/${item.id}/completions`)).statusCode).toBe(404);
		expect((await h.owner.api.post(`${base(h.adult)}/rewards/x/redemptions`)).statusCode).toBe(404);
	});

	it("adjusts the ward's coins with a note, and only theirs", async () => {
		await supervise(h.owner, h.adult);
		const res = await h.owner.api.post(`${base(h.adult)}/adjustments`, { amount: 10, note: "Chores bonus" });
		expect(res.statusCode).toBe(201);
		expect(res.json().balance).toBe(10);
		expect((await balances(h.adult)).personal).toBe(10);
		expect((await h.owner.api.post(`${base(h.adult)}/adjustments`, { amount: 0, note: "x" })).statusCode).toBe(400);
		expect((await h.owner.api.post(`${base(h.adult)}/adjustments`, { amount: 1 })).statusCode).toBe(400);
		// No way to adjust yourself or someone you do not supervise.
		expect(
			(await h.owner.api.post(`/supervision/wards/${h.owner.userId}/adjustments`, { amount: 5, note: "me" }))
				.statusCode,
		).toBe(404);
		expect((await h.adult.api.post(`${base(h.kid)}/adjustments`, { amount: 5, note: "x" })).statusCode).toBe(404);
	});

	it("approves or rejects the ward's completions that need approval", async () => {
		await supervise(h.owner, h.adult);
		const item = await makeHabit(h.owner, { assigneeIds: [h.adult.userId], requiresApproval: true, reward: 6 });
		await h.adult.api.post(`/items/${item.id}/completions`);
		const pending = (await h.owner.api.get(`${base(h.adult)}/pending`)).json().completions;
		expect(pending).toEqual([expect.objectContaining({ itemName: "Drink water", status: "pending" })]);
		expect((await balances(h.adult)).personal).toBe(0);

		const approved = await h.owner.api.post(`${base(h.adult)}/completions/${pending[0].id}/approve`);
		expect(approved.statusCode).toBe(200);
		expect(approved.json().completion.status).toBe("approved");
		expect((await balances(h.adult)).personal).toBe(6);
		expect((await h.owner.api.post(`${base(h.adult)}/completions/${pending[0].id}/approve`)).json().code).toBe(
			"not_pending",
		);

		await h.adult.api.post(`/items/${item.id}/completions`, { date: "2026-11-16" });
		const second = (await h.owner.api.get(`${base(h.adult)}/pending`)).json().completions[0];
		const rejected = await h.owner.api.post(`${base(h.adult)}/completions/${second.id}/reject`);
		expect(rejected.json().completion.status).toBe("rejected");
		expect((await balances(h.adult)).personal).toBe(6);
	});

	it("shows nothing of accounts you do not supervise, to anyone, super admins included", async () => {
		await supervise(h.owner, h.adult);
		// A plain account created by the super admin: alice is super admin yet sees nothing of it.
		const zoe = await newLoneAccount(ctx, h.owner, "zoe");
		for (const url of [
			`/supervision/wards/${zoe.id}/items`,
			`/supervision/wards/${zoe.id}/pending`,
			`/supervision/wards/${zoe.id}/me`,
		]) {
			expect((await h.owner.api.get(url)).statusCode).toBe(404);
		}
		// bob supervises nobody: kid is not his to see.
		expect((await h.adult.api.get(`${base(h.kid)}/items`)).statusCode).toBe(404);
		// A ward does not see their guardian's space either.
		expect((await h.adult.api.get(`/supervision/wards/${h.owner.userId}/items`)).statusCode).toBe(404);
	});

	it("only a guardian changes the rights", async () => {
		await supervise(h.owner, h.adult);
		expect(
			(await h.adult.api.patch(`/supervision/wards/${h.adult.userId}/rights`, { canCreate: true })).statusCode,
		).toBe(404);
		expect((await h.kid.api.patch(`${base(h.adult)}/rights`, { canCreate: true })).statusCode).toBe(404);
		expect((await h.owner.api.patch(`${base(h.adult)}/rights`, {})).statusCode).toBe(400);
	});
});

describe("leaving supervision behind", () => {
	const kidApproval = async () => {
		const item = await makeHabit(h.adult, { assigneeIds: [h.kid.userId], requiresApproval: true });
		const pending = (await h.kid.api.post(`/items/${item.id}/completions`)).json().completion;
		return { item, pending };
	};

	it("ending the last supervision rejects what waited for approval, and frees the day's goal", async () => {
		const { item, pending } = await kidApproval();
		expect((await h.kid.api.post(`/items/${item.id}/completions`)).json().code).toBe("target_reached");
		expect((await h.owner.api.del(base(h.kid))).statusCode).toBe(204);
		const rows = ctx.db.select().from(completions).where(eq(completions.id, pending.id)).all();
		expect(rows[0]?.status).toBe("rejected");
		expect((await balances(h.kid)).personal).toBe(0);
		// The account is no longer supervised, so the item no longer needs approval and the day is free again.
		expect((await h.kid.api.post(`/items/${item.id}/completions`)).statusCode).toBe(201);
	});

	it("with another guardian left, pending completions keep waiting", async () => {
		const code = (await h.adult.api.post("/supervision/codes", { kind: "supervise" })).json();
		expect((await h.kid.api.post("/supervision/redeem", { code: code.token })).statusCode).toBe(201);
		const { pending } = await kidApproval();
		await h.owner.api.del(base(h.kid));
		expect(ctx.db.select().from(completions).where(eq(completions.id, pending.id)).get()?.status).toBe("pending");
		const list = (await h.adult.api.get("/supervision/pending")).json().completions;
		expect(list.map((c: { id: string }) => c.id)).toEqual([pending.id]);
	});

	it("deleting a guardian ends their supervisions and releases wards left without one", async () => {
		const { pending } = await kidApproval();
		const second = await newLoneAccount(ctx, h.owner, "zoe");
		await h.owner.api.patch(`/admin/users/${second.id}`, { isSuperAdmin: true });
		expect((await second.api.del(`/admin/users/${h.owner.userId}`)).statusCode).toBe(204);
		expect(ctx.db.select().from(guardianships).all()).toEqual([]);
		expect((await h.kid.api.get("/supervision")).json()).toMatchObject({ guardians: [], rights: null });
		expect(ctx.db.select().from(completions).where(eq(completions.id, pending.id)).get()?.status).toBe("rejected");
	});

	it("deleting a ward removes them from their guardian's list", async () => {
		expect((await h.owner.api.del(`/admin/users/${h.kid.userId}`)).statusCode).toBe(204);
		expect((await h.owner.api.get("/supervision")).json().wards).toEqual([]);
	});
});
