// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type Actor, can } from "./permissions.js";

const owner: Actor = { userId: "o", role: "owner", canCreateItems: false };
const adult: Actor = { userId: "a", role: "adult", canCreateItems: false };
const child: Actor = { userId: "c", role: "child", canCreateItems: false };
const trustedChild: Actor = { userId: "c", role: "child", canCreateItems: true };

describe("can — create and update items", () => {
	it("owner and adult create for themselves and for others", () => {
		for (const actor of [owner, adult]) {
			expect(can(actor, "item:create", { assigneeIds: [actor.userId] })).toBe(true);
			expect(can(actor, "item:create", { assigneeIds: ["c", "x"] })).toBe(true);
		}
	});

	it("a child only creates for themselves, and only if allowed", () => {
		expect(can(child, "item:create", { assigneeIds: ["c"] })).toBe(false);
		expect(can(trustedChild, "item:create", { assigneeIds: ["c"] })).toBe(true);
		expect(can(trustedChild, "item:create", { assigneeIds: ["c", "a"] })).toBe(false);
		expect(can(trustedChild, "item:create", { assigneeIds: ["a"] })).toBe(false);
	});

	it("an allowed child only updates what they created", () => {
		expect(can(trustedChild, "item:update", { createdBy: "c" })).toBe(true);
		expect(can(trustedChild, "item:update", { createdBy: "a" })).toBe(false);
		expect(can(child, "item:update", { createdBy: "c" })).toBe(false);
		expect(can(adult, "item:update", { createdBy: "c" })).toBe(true);
	});
});

describe("can — complete and approve", () => {
	it("everyone completes their own items, never someone else's", () => {
		for (const actor of [owner, adult, child]) {
			expect(can(actor, "completion:create", { userId: actor.userId })).toBe(true);
			expect(can(actor, "completion:create", { userId: "autre" })).toBe(false);
		}
	});

	it("undo: your own completion, or an owner/adult for a child (the owner for everyone)", () => {
		expect(can(child, "completion:undo", { userId: "c", userRole: "child" })).toBe(true);
		expect(can(child, "completion:undo", { userId: "a", userRole: "adult" })).toBe(false);
		expect(can(adult, "completion:undo", { userId: "c", userRole: "child" })).toBe(true);
		expect(can(adult, "completion:undo", { userId: "o", userRole: "owner" })).toBe(false);
		expect(can(owner, "completion:undo", { userId: "a", userRole: "adult" })).toBe(true);
	});

	it("undo a wish redemption: same rights as undoing a completion", () => {
		expect(can(child, "redemption:undo", { userId: "c", userRole: "child" })).toBe(true);
		expect(can(child, "redemption:undo", { userId: "a", userRole: "adult" })).toBe(false);
		expect(can(adult, "redemption:undo", { userId: "c", userRole: "child" })).toBe(true);
		expect(can(adult, "redemption:undo", { userId: "o", userRole: "owner" })).toBe(false);
		expect(can(owner, "redemption:undo", { userId: "a", userRole: "adult" })).toBe(true);
	});

	it("approve: owner and adult, never a child, never their own completion", () => {
		expect(can(owner, "completion:approve", { userId: "c" })).toBe(true);
		expect(can(adult, "completion:approve", { userId: "c" })).toBe(true);
		expect(can(child, "completion:approve", { userId: "c2" })).toBe(false);
		expect(can(adult, "completion:approve", { userId: "a" })).toBe(false);
	});

	it("list completions to approve: owner and adult", () => {
		expect(can(owner, "completion:review")).toBe(true);
		expect(can(adult, "completion:review")).toBe(true);
		expect(can(child, "completion:review")).toBe(false);
	});

	it("past day: within the window for everyone, beyond it only the owner", () => {
		expect(can(child, "completion:backdate", { daysAgo: 2, windowDays: 2 })).toBe(true);
		expect(can(adult, "completion:backdate", { daysAgo: 3, windowDays: 2 })).toBe(false);
		expect(can(owner, "completion:backdate", { daysAgo: 30, windowDays: 2 })).toBe(true);
	});
});

describe("can — coins and wishes", () => {
	it("personal wish: if you are part of it (empty list = everyone)", () => {
		expect(can(child, "reward:redeem", { fundedFrom: "personal", assigneeIds: [] })).toBe(true);
		expect(can(child, "reward:redeem", { fundedFrom: "personal", assigneeIds: ["c"] })).toBe(true);
		expect(can(child, "reward:redeem", { fundedFrom: "personal", assigneeIds: ["a"] })).toBe(false);
	});

	it("wish funded by the pot: owner and adult only", () => {
		expect(can(owner, "reward:redeem", { fundedFrom: "shared", assigneeIds: [] })).toBe(true);
		expect(can(adult, "reward:redeem", { fundedFrom: "shared", assigneeIds: [] })).toBe(true);
		expect(can(child, "reward:redeem", { fundedFrom: "shared", assigneeIds: [] })).toBe(false);
	});

	it("manage wishes: owner and adult", () => {
		expect(can(adult, "reward:manage")).toBe(true);
		expect(can(child, "reward:manage")).toBe(false);
	});

	it("transfer to the pot: any member", () => {
		for (const actor of [owner, adult, child]) expect(can(actor, "transfer:create")).toBe(true);
	});

	it("manual adjustment and household management: owner only", () => {
		expect(can(owner, "ledger:adjust")).toBe(true);
		expect(can(adult, "ledger:adjust")).toBe(false);
		expect(can(child, "ledger:adjust")).toBe(false);
		expect(can(owner, "household:manage")).toBe(true);
		expect(can(adult, "household:manage")).toBe(false);
	});
});
