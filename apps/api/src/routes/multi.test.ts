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

/** bob (adult in "The Smiths") also creates and owns a second household, "Flat". */
async function bobWithFlat() {
	const flat = (await h.adult.api.post("/households", { name: "Flat" })).json().householdId as string;
	const smiths = (await h.owner.api.get("/account")).json().households[0].id as string;
	return { flat, smiths, inFlat: { "x-household-id": flat }, inSmiths: { "x-household-id": smiths } };
}

describe("several households", () => {
	it("an account belongs to several households, each with its own role and pot", async () => {
		const { flat, smiths } = await bobWithFlat();
		const me = (await h.adult.api.get("/me")).json();
		expect(me.households.map((x: { id: string; role: string }) => [x.id, x.role]).sort()).toEqual(
			[
				[smiths, "adult"],
				[flat, "owner"],
			].sort(),
		);
		// The oldest membership is the active one unless the client says otherwise.
		expect(me.household.id).toBe(smiths);
		const inFlat = (await h.adult.api.get("/me", { "x-household-id": flat })).json();
		expect(inFlat).toMatchObject({ role: "owner", household: { id: flat } });
		expect(inFlat.wallets.shared.id).not.toBe(me.wallets.shared.id);
		// A household the person does not belong to is ignored.
		const other = (await h.owner.api.get("/me", { "x-household-id": "nope" })).json();
		expect(other.household.id).toBe(smiths);
	});

	it("shows items of all households and personal ones together, each with its household", async () => {
		const { flat } = await bobWithFlat();
		await makeHabit(h.owner, { name: "Dishes" });
		await makeHabit(h.adult, { name: "Garden", scope: "household", householdId: flat });
		await makeHabit(h.adult, { name: "Read", scope: "personal" });
		const items = (await h.adult.api.get("/items")).json().items;
		expect(items.map((i: { name: string }) => i.name).sort()).toEqual(["Dishes", "Garden", "Read"]);
		expect((await h.adult.api.get("/today")).json().items).toHaveLength(2); // Dishes isn't assigned to bob
		// The owner of the first household only sees theirs.
		expect((await h.owner.api.get("/items")).json().items.map((i: { name: string }) => i.name)).toEqual(["Dishes"]);
	});

	it("rights come from the household of the item, not from the active one", async () => {
		const { flat, inFlat } = await bobWithFlat();
		const dishes = await makeHabit(h.owner, { name: "Dishes", assigneeIds: [h.adult.userId, h.kid.userId] });
		// bob is only an adult in The Smiths, but the owner of Flat: he can invite there, not in The Smiths.
		expect((await h.adult.api.post("/household/invites", { role: "adult" }, inFlat)).statusCode).toBe(201);
		expect((await h.adult.api.post("/household/invites", { role: "adult" })).statusCode).toBe(403);
		// Even when Flat is the active household, bob completes The Smiths' item with his Smiths role.
		const done = await h.adult.api.post(`/items/${dishes.id}/completions`, {}, inFlat);
		expect(done.statusCode).toBe(201);
		expect(flat).toBeTruthy();
	});

	it("a child in one household and an adult in another follows each household's rules", async () => {
		const flat = (await h.owner.api.post("/households", { name: "Flat" })).json().householdId as string;
		const invite = (await h.owner.api.post("/household/invites", { role: "adult" }, { "x-household-id": flat })).json();
		expect((await h.kid.api.post("/household/join", { code: invite.token })).statusCode).toBe(201);
		const inFlat = { "x-household-id": flat };
		// In Flat the kid is an adult but the child restriction elsewhere still blocks personal minting.
		expect((await h.kid.api.post("/items", { kind: "task", name: "x", scope: "personal" })).statusCode).toBe(403);
		// Adult in Flat: can create there.
		expect(
			(
				await h.kid.api.post(
					"/items",
					{ kind: "task", name: "Flat task", scope: "household", householdId: flat },
					inFlat,
				)
			).statusCode,
		).toBe(201);
		// Child in The Smiths without the right: refused there.
		expect((await h.kid.api.post("/items", { kind: "task", name: "Smiths task", scope: "household" })).statusCode).toBe(
			403,
		);
	});

	it("the pot is the one of the item's household, whichever is active", async () => {
		const { flat, smiths, inFlat } = await bobWithFlat();
		const item = await makeHabit(h.adult, {
			name: "Garden",
			scope: "household",
			householdId: flat,
			reward: 7,
			creditsTo: "shared",
		});
		// Complete while The Smiths is the active household: the coins still go to Flat's pot.
		await h.adult.api.post(`/items/${item.id}/completions`);
		expect((await h.adult.api.get("/me", inFlat)).json().wallets.shared.balance).toBe(7);
		expect((await h.adult.api.get("/me", { "x-household-id": smiths })).json().wallets.shared.balance).toBe(0);
	});

	it("leaving one household keeps the others", async () => {
		const { flat } = await bobWithFlat();
		expect((await h.adult.api.post("/household/leave")).statusCode).toBe(204); // active = The Smiths
		const me = (await h.adult.api.get("/me")).json();
		expect(me.households.map((x: { id: string }) => x.id)).toEqual([flat]);
		expect(me.household.id).toBe(flat);
	});

	it("shows the other households' items nowhere after leaving", async () => {
		const dishes = await makeHabit(h.owner, { name: "Dishes", assigneeIds: [h.adult.userId] });
		await h.adult.api.post("/household/leave");
		expect((await h.adult.api.get("/items")).json().items).toEqual([]);
		expect((await h.adult.api.post(`/items/${dishes.id}/completions`)).statusCode).toBe(404);
	});

	it("time zone and first weekday belong to the person", async () => {
		const res = await h.adult.api.patch("/account", { timezone: "America/New_York", weekStart: 7 });
		expect(res.json()).toMatchObject({ timezone: "America/New_York", weekStart: 7 });
		expect((await h.adult.api.patch("/account", { timezone: "Nope/Nowhere" })).statusCode).toBe(400);
		expect((await h.adult.api.patch("/account", {})).statusCode).toBe(400);
	});
});
