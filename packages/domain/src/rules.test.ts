// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
	assertUnderTarget,
	balanceOf,
	checkCompletionDate,
	DomainError,
	periodStart,
	planCompletion,
	planRedemption,
	planTransfer,
} from "./rules.js";

const codeOf = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		if (e instanceof DomainError) return e.code;
		throw e;
	}
	return null;
};

describe("planCompletion", () => {
	it("credits the reward when no approval is required", () => {
		expect(planCompletion({ actorRole: "adult", requiresApproval: false, reward: 5 })).toEqual({
			status: "approved",
			credit: 5,
		});
		expect(planCompletion({ actorRole: "child", requiresApproval: false, reward: 5 })).toEqual({
			status: "approved",
			credit: 5,
		});
	});

	it("a child on an item needing approval: pending, no entry", () => {
		expect(planCompletion({ actorRole: "child", requiresApproval: true, reward: 5 })).toEqual({
			status: "pending",
			credit: 0,
		});
	});

	it("approval only concerns children", () => {
		expect(planCompletion({ actorRole: "adult", requiresApproval: true, reward: 5 })).toEqual({
			status: "approved",
			credit: 5,
		});
		expect(planCompletion({ actorRole: "owner", requiresApproval: true, reward: 5 })).toEqual({
			status: "approved",
			credit: 5,
		});
	});

	it("a zero reward credits nothing", () => {
		expect(planCompletion({ actorRole: "adult", requiresApproval: false, reward: 0 }).credit).toBe(0);
	});
});

describe("assertUnderTarget", () => {
	it("allows up to the goal, rejects beyond it with target_reached", () => {
		expect(codeOf(() => assertUnderTarget(0, 3))).toBeNull();
		expect(codeOf(() => assertUnderTarget(2, 3))).toBeNull();
		expect(codeOf(() => assertUnderTarget(3, 3))).toBe("target_reached");
		expect(codeOf(() => assertUnderTarget(4, 3))).toBe("target_reached");
	});
});

describe("checkCompletionDate", () => {
	const base = { today: "2026-11-17", windowDays: 2 };
	it("accepts today and the past-days window", () => {
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-17", role: "child" }))).toBeNull();
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-15", role: "child" }))).toBeNull();
	});
	it("rejects the future for everyone, owner included", () => {
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-18", role: "owner" }))).toBe("future_date");
	});
	it("beyond the window: only an owner", () => {
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-14", role: "adult" }))).toBe(
			"backdate_not_allowed",
		);
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-14", role: "owner" }))).toBeNull();
	});
	it("window of 0: today only", () => {
		expect(
			codeOf(() => checkCompletionDate({ today: "2026-11-17", date: "2026-11-16", windowDays: 0, role: "adult" })),
		).toBe("backdate_not_allowed");
	});
});

describe("planTransfer", () => {
	it("produces two opposite entries", () => {
		expect(planTransfer({ balance: 10, amount: 4 })).toEqual([
			{ wallet: "from", amount: -4 },
			{ wallet: "to", amount: 4 },
		]);
	});
	it("allows transferring everything, rejects exceeding the balance (insufficient_balance)", () => {
		expect(codeOf(() => planTransfer({ balance: 10, amount: 10 }))).toBeNull();
		expect(codeOf(() => planTransfer({ balance: 10, amount: 11 }))).toBe("insufficient_balance");
		expect(codeOf(() => planTransfer({ balance: 0, amount: 1 }))).toBe("insufficient_balance");
	});
	it("rejects a zero, negative or non-integer amount", () => {
		expect(codeOf(() => planTransfer({ balance: 10, amount: 0 }))).toBe("invalid_amount");
		expect(codeOf(() => planTransfer({ balance: 10, amount: -3 }))).toBe("invalid_amount");
		expect(codeOf(() => planTransfer({ balance: 10, amount: 1.5 }))).toBe("invalid_amount");
	});
});

describe("planRedemption", () => {
	it("debits the cost", () => {
		expect(planRedemption({ cost: 8, balance: 10, usedInPeriod: 0, limitCount: null })).toEqual({ amount: -8 });
	});
	it("insufficient balance", () => {
		expect(codeOf(() => planRedemption({ cost: 8, balance: 7, usedInPeriod: 0, limitCount: null }))).toBe(
			"insufficient_balance",
		);
	});
	it("per-period usage limit reached", () => {
		expect(codeOf(() => planRedemption({ cost: 1, balance: 10, usedInPeriod: 2, limitCount: 2 }))).toBe(
			"limit_reached",
		);
		expect(codeOf(() => planRedemption({ cost: 1, balance: 10, usedInPeriod: 1, limitCount: 2 }))).toBeNull();
	});
	it("the limit is checked before the balance", () => {
		expect(codeOf(() => planRedemption({ cost: 99, balance: 0, usedInPeriod: 1, limitCount: 1 }))).toBe(
			"limit_reached",
		);
	});
});

describe("periodStart", () => {
	it("computes the start of the period as a local day", () => {
		expect(periodStart("day", "2026-11-17", 1)).toBe("2026-11-17");
		expect(periodStart("week", "2026-11-17", 1)).toBe("2026-11-16");
		expect(periodStart("week", "2026-11-17", 7)).toBe("2026-11-15");
		expect(periodStart("month", "2026-11-17", 1)).toBe("2026-11-01");
		expect(periodStart("year", "2026-11-17", 1)).toBe("2026-01-01");
	});
});

describe("balanceOf", () => {
	it("sums the entries, a balance never being stored", () => {
		expect(balanceOf([])).toBe(0);
		expect(balanceOf([{ amount: 5 }, { amount: 5 }, { amount: -3 }])).toBe(7);
	});
});
