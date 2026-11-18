// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type Actor, can } from "./permissions.js";
import { DEFAULT_WARD_RIGHTS } from "./supervision.js";

const owner: Actor = { userId: "o", role: "owner", supervised: null };
const member: Actor = { userId: "m", role: "member", supervised: null };
const ward: Actor = { userId: "w", role: "member", supervised: DEFAULT_WARD_RIGHTS };

describe("can — items", () => {
	it("every member creates and updates items, for themselves and for others", () => {
		for (const actor of [owner, member]) {
			expect(can(actor, "item:create", { assigneeIds: [actor.userId, "x"] })).toBe(true);
			expect(can(actor, "item:update", { createdBy: "x" })).toBe(true);
		}
	});
});

describe("can — complete and undo", () => {
	it("everyone completes their own items, never someone else's", () => {
		for (const actor of [owner, member, ward]) {
			expect(can(actor, "completion:create", { userId: actor.userId })).toBe(true);
			expect(can(actor, "completion:create", { userId: "other" })).toBe(false);
		}
	});

	it("undo: your own completion, or an owner for anyone", () => {
		expect(can(member, "completion:undo", { userId: "m" })).toBe(true);
		expect(can(member, "completion:undo", { userId: "w" })).toBe(false);
		expect(can(owner, "completion:undo", { userId: "w" })).toBe(true);
	});

	it("undo a wish redemption: same rights as undoing a completion", () => {
		expect(can(member, "redemption:undo", { userId: "m" })).toBe(true);
		expect(can(member, "redemption:undo", { userId: "w" })).toBe(false);
		expect(can(owner, "redemption:undo", { userId: "w" })).toBe(true);
	});

	it("a past day beyond the window is for owners only", () => {
		expect(can(member, "completion:backdate", { daysAgo: 2, windowDays: 2 })).toBe(true);
		expect(can(member, "completion:backdate", { daysAgo: 3, windowDays: 2 })).toBe(false);
		expect(can(owner, "completion:backdate", { daysAgo: 30, windowDays: 2 })).toBe(true);
	});
});

describe("can — wishes, pot and household", () => {
	it("a supervised account cannot pay from the pot, anyone else can", () => {
		expect(can(ward, "reward:redeem", { fundedFrom: "shared", assigneeIds: [] })).toBe(false);
		expect(can(ward, "reward:redeem", { fundedFrom: "personal", assigneeIds: [] })).toBe(true);
		expect(can(member, "reward:redeem", { fundedFrom: "shared", assigneeIds: [] })).toBe(true);
	});

	it("a wish assigned to others is not redeemable by the rest", () => {
		expect(can(member, "reward:redeem", { fundedFrom: "personal", assigneeIds: ["x"] })).toBe(false);
		expect(can(member, "reward:redeem", { fundedFrom: "personal", assigneeIds: ["x", "m"] })).toBe(true);
	});

	it("giving to a pot is open (supervision limits it separately)", () => {
		for (const actor of [owner, member, ward]) expect(can(actor, "transfer:create")).toBe(true);
	});

	it("only owners adjust coins and manage the household", () => {
		expect(can(owner, "ledger:adjust")).toBe(true);
		expect(can(member, "ledger:adjust")).toBe(false);
		expect(can(owner, "household:manage")).toBe(true);
		expect(can(member, "household:manage")).toBe(false);
	});
});
