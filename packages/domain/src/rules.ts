// SPDX-License-Identifier: AGPL-3.0-or-later
import { daysBetween, type LocalDate, startOfWeek, type Weekday } from "./dates.js";
import type { Role } from "./roles.js";

export type DomainErrorCode =
	| "target_reached"
	| "insufficient_balance"
	| "limit_reached"
	| "invalid_amount"
	| "future_date"
	| "backdate_not_allowed"
	| "not_due"
	| "last_owner"
	| "cannot_remove_self"
	| "cannot_target_self"
	| "last_super_admin"
	| "already_supervising"
	| "guardian_cycle";

/** Business rule violated; the API turns it into a 4xx response with this stable `code`. */
export class DomainError extends Error {
	constructor(
		readonly code: DomainErrorCode,
		message: string,
	) {
		super(message);
		this.name = "DomainError";
	}
}

/**
 * Complete an item. Only a child on an item that "needs approval" goes pending (no entry);
 * the server then credits `credit` coins, never an amount coming from the client.
 */
export function planCompletion(input: { actorRole: Role; requiresApproval: boolean; reward: number }): {
	status: "approved" | "pending";
	credit: number;
} {
	if (input.requiresApproval && input.actorRole === "child") return { status: "pending", credit: 0 };
	return { status: "approved", credit: input.reward };
}

/** `existing` = completions already counted that day (pending included); beyond that: 409 target_reached. */
export function assertUnderTarget(existing: number, target: number): void {
	if (existing >= target) throw new DomainError("target_reached", "Today's goal is already reached");
}

/** Completion day: not in the future, and within the `backdate_days` window except for an owner. */
export function checkCompletionDate(input: {
	date: LocalDate;
	today: LocalDate;
	/** How many days back are allowed; `Number.POSITIVE_INFINITY` = no limit. */
	windowDays: number;
	role: Role;
}): void {
	const daysAgo = daysBetween(input.date, input.today);
	if (daysAgo < 0) throw new DomainError("future_date", "Cannot complete a future day");
	if (daysAgo > input.windowDays && input.role !== "owner") {
		throw new DomainError("backdate_not_allowed", `Completion allowed up to ${input.windowDays} day(s) back`);
	}
}

function assertAmount(amount: number): void {
	if (!Number.isSafeInteger(amount) || amount <= 0) {
		throw new DomainError("invalid_amount", "The amount must be a positive integer");
	}
}

/** Personal → pot transfer: two opposite entries, linked by one `transfer_id` on the server. */
export function planTransfer(input: { balance: number; amount: number }) {
	assertAmount(input.amount);
	if (input.amount > input.balance) throw new DomainError("insufficient_balance", "Insufficient balance");
	return [
		{ wallet: "from", amount: -input.amount },
		{ wallet: "to", amount: input.amount },
	] as const;
}

/** Wish redemption: per-period limit first, then balance. */
export function planRedemption(input: {
	cost: number;
	balance: number;
	usedInPeriod: number;
	limitCount: number | null;
}): { amount: number } {
	if (input.limitCount !== null && input.usedInPeriod >= input.limitCount) {
		throw new DomainError("limit_reached", "Usage limit reached for this period");
	}
	if (input.cost > input.balance) throw new DomainError("insufficient_balance", "Insufficient balance");
	return { amount: -input.cost };
}

export type LimitPeriod = "day" | "week" | "month" | "year";

/** First local day of the period containing `date`. */
export function periodStart(period: LimitPeriod, date: LocalDate, weekStart: Weekday): LocalDate {
	switch (period) {
		case "day":
			return date;
		case "week":
			return startOfWeek(date, weekStart);
		case "month":
			return `${date.slice(0, 8)}01`;
		case "year":
			return `${date.slice(0, 4)}-01-01`;
	}
}

/** A balance is never stored: it is the sum of the wallet's entries. */
export function balanceOf(entries: readonly { amount: number }[]): number {
	return entries.reduce((sum, e) => sum + e.amount, 0);
}
