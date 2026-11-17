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
	it("crédite la récompense quand aucun accord n'est requis", () => {
		expect(planCompletion({ actorRole: "adult", requiresApproval: false, reward: 5 })).toEqual({
			status: "approved",
			credit: 5,
		});
		expect(planCompletion({ actorRole: "child", requiresApproval: false, reward: 5 })).toEqual({
			status: "approved",
			credit: 5,
		});
	});

	it("un enfant sur un élément à accord : en attente, aucune écriture", () => {
		expect(planCompletion({ actorRole: "child", requiresApproval: true, reward: 5 })).toEqual({
			status: "pending",
			credit: 0,
		});
	});

	it("l'accord ne concerne que les enfants", () => {
		expect(planCompletion({ actorRole: "adult", requiresApproval: true, reward: 5 })).toEqual({
			status: "approved",
			credit: 5,
		});
		expect(planCompletion({ actorRole: "owner", requiresApproval: true, reward: 5 })).toEqual({
			status: "approved",
			credit: 5,
		});
	});

	it("une récompense nulle ne crédite rien", () => {
		expect(planCompletion({ actorRole: "adult", requiresApproval: false, reward: 0 }).credit).toBe(0);
	});
});

describe("assertUnderTarget", () => {
	it("autorise jusqu'à l'objectif, refuse au-delà avec target_reached", () => {
		expect(codeOf(() => assertUnderTarget(0, 3))).toBeNull();
		expect(codeOf(() => assertUnderTarget(2, 3))).toBeNull();
		expect(codeOf(() => assertUnderTarget(3, 3))).toBe("target_reached");
		expect(codeOf(() => assertUnderTarget(4, 3))).toBe("target_reached");
	});
});

describe("checkCompletionDate", () => {
	const base = { today: "2026-11-17", windowDays: 2 };
	it("accepte aujourd'hui et la fenêtre de jours passés", () => {
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-17", role: "child" }))).toBeNull();
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-15", role: "child" }))).toBeNull();
	});
	it("refuse le futur pour tout le monde, owner compris", () => {
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-18", role: "owner" }))).toBe("future_date");
	});
	it("au-delà de la fenêtre : seulement un owner", () => {
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-14", role: "adult" }))).toBe(
			"backdate_not_allowed",
		);
		expect(codeOf(() => checkCompletionDate({ ...base, date: "2026-11-14", role: "owner" }))).toBeNull();
	});
	it("fenêtre de 0 : aujourd'hui seulement", () => {
		expect(
			codeOf(() => checkCompletionDate({ today: "2026-11-17", date: "2026-11-16", windowDays: 0, role: "adult" })),
		).toBe("backdate_not_allowed");
	});
});

describe("planTransfer", () => {
	it("produit deux écritures opposées", () => {
		expect(planTransfer({ balance: 10, amount: 4 })).toEqual([
			{ wallet: "from", amount: -4 },
			{ wallet: "to", amount: 4 },
		]);
	});
	it("autorise de tout virer, refuse de dépasser le solde (insufficient_balance)", () => {
		expect(codeOf(() => planTransfer({ balance: 10, amount: 10 }))).toBeNull();
		expect(codeOf(() => planTransfer({ balance: 10, amount: 11 }))).toBe("insufficient_balance");
		expect(codeOf(() => planTransfer({ balance: 0, amount: 1 }))).toBe("insufficient_balance");
	});
	it("refuse un montant nul, négatif ou non entier", () => {
		expect(codeOf(() => planTransfer({ balance: 10, amount: 0 }))).toBe("invalid_amount");
		expect(codeOf(() => planTransfer({ balance: 10, amount: -3 }))).toBe("invalid_amount");
		expect(codeOf(() => planTransfer({ balance: 10, amount: 1.5 }))).toBe("invalid_amount");
	});
});

describe("planRedemption", () => {
	it("débite le coût", () => {
		expect(planRedemption({ cost: 8, balance: 10, usedInPeriod: 0, limitCount: null })).toEqual({ amount: -8 });
	});
	it("solde insuffisant", () => {
		expect(codeOf(() => planRedemption({ cost: 8, balance: 7, usedInPeriod: 0, limitCount: null }))).toBe(
			"insufficient_balance",
		);
	});
	it("limite d'usage par période atteinte", () => {
		expect(codeOf(() => planRedemption({ cost: 1, balance: 10, usedInPeriod: 2, limitCount: 2 }))).toBe(
			"limit_reached",
		);
		expect(codeOf(() => planRedemption({ cost: 1, balance: 10, usedInPeriod: 1, limitCount: 2 }))).toBeNull();
	});
	it("la limite est vérifiée avant le solde", () => {
		expect(codeOf(() => planRedemption({ cost: 99, balance: 0, usedInPeriod: 1, limitCount: 1 }))).toBe(
			"limit_reached",
		);
	});
});

describe("periodStart", () => {
	it("calcule le début de la période en jour local", () => {
		expect(periodStart("day", "2026-11-17", 1)).toBe("2026-11-17");
		expect(periodStart("week", "2026-11-17", 1)).toBe("2026-11-16");
		expect(periodStart("week", "2026-11-17", 7)).toBe("2026-11-15");
		expect(periodStart("month", "2026-11-17", 1)).toBe("2026-11-01");
		expect(periodStart("year", "2026-11-17", 1)).toBe("2026-01-01");
	});
});

describe("balanceOf", () => {
	it("somme les écritures, un solde n'étant jamais stocké", () => {
		expect(balanceOf([])).toBe(0);
		expect(balanceOf([{ amount: 5 }, { amount: 5 }, { amount: -3 }])).toBe(7);
	});
});
