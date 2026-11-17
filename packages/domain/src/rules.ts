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
	| "not_due";

/** Règle métier violée ; l'API la traduit en réponse 4xx avec ce `code` stable. */
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
 * Valider un élément. Seul un enfant sur un élément « à accord » passe en attente (aucune écriture) ;
 * le serveur crédite ensuite `credit` pièces, jamais un montant venu du client.
 */
export function planCompletion(input: { actorRole: Role; requiresApproval: boolean; reward: number }): {
	status: "approved" | "pending";
	credit: number;
} {
	if (input.requiresApproval && input.actorRole === "child") return { status: "pending", credit: 0 };
	return { status: "approved", credit: input.reward };
}

/** `existing` = validations déjà comptées ce jour-là (en attente comprises) ; au-delà : 409 target_reached. */
export function assertUnderTarget(existing: number, target: number): void {
	if (existing >= target) throw new DomainError("target_reached", "L'objectif du jour est déjà atteint");
}

/** Jour de la validation : pas dans le futur, et dans la fenêtre `backdate_days` sauf pour un owner. */
export function checkCompletionDate(input: {
	date: LocalDate;
	today: LocalDate;
	windowDays: number;
	role: Role;
}): void {
	const daysAgo = daysBetween(input.date, input.today);
	if (daysAgo < 0) throw new DomainError("future_date", "Impossible de valider un jour futur");
	if (daysAgo > input.windowDays && input.role !== "owner") {
		throw new DomainError("backdate_not_allowed", `Validation possible jusqu'à ${input.windowDays} jour(s) en arrière`);
	}
}

function assertAmount(amount: number): void {
	if (!Number.isSafeInteger(amount) || amount <= 0) {
		throw new DomainError("invalid_amount", "Le montant doit être un entier positif");
	}
}

/** Virement perso → cagnotte : deux écritures opposées, liées par un même `transfer_id` côté serveur. */
export function planTransfer(input: { balance: number; amount: number }) {
	assertAmount(input.amount);
	if (input.amount > input.balance) throw new DomainError("insufficient_balance", "Solde insuffisant");
	return [
		{ wallet: "from", amount: -input.amount },
		{ wallet: "to", amount: input.amount },
	] as const;
}

/** Échange d'une envie : limite par période d'abord, puis solde. */
export function planRedemption(input: {
	cost: number;
	balance: number;
	usedInPeriod: number;
	limitCount: number | null;
}): { amount: number } {
	if (input.limitCount !== null && input.usedInPeriod >= input.limitCount) {
		throw new DomainError("limit_reached", "Limite d'usage atteinte pour cette période");
	}
	if (input.cost > input.balance) throw new DomainError("insufficient_balance", "Solde insuffisant");
	return { amount: -input.cost };
}

export type LimitPeriod = "day" | "week" | "month" | "year";

/** Premier jour local de la période contenant `date`. */
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

/** Un solde n'est jamais stocké : c'est la somme des écritures du porte-monnaie. */
export function balanceOf(entries: readonly { amount: number }[]): number {
	return entries.reduce((sum, e) => sum + e.amount, 0);
}
