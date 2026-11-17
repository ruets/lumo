// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type Actor, can } from "./permissions.js";

const owner: Actor = { userId: "o", role: "owner", canCreateItems: false };
const adult: Actor = { userId: "a", role: "adult", canCreateItems: false };
const child: Actor = { userId: "c", role: "child", canCreateItems: false };
const trustedChild: Actor = { userId: "c", role: "child", canCreateItems: true };

describe("can — créer et modifier des éléments", () => {
	it("owner et adulte créent pour eux et pour les autres", () => {
		for (const actor of [owner, adult]) {
			expect(can(actor, "item:create", { assigneeIds: [actor.userId] })).toBe(true);
			expect(can(actor, "item:create", { assigneeIds: ["c", "x"] })).toBe(true);
		}
	});

	it("un enfant ne crée que pour lui, et seulement si c'est autorisé", () => {
		expect(can(child, "item:create", { assigneeIds: ["c"] })).toBe(false);
		expect(can(trustedChild, "item:create", { assigneeIds: ["c"] })).toBe(true);
		expect(can(trustedChild, "item:create", { assigneeIds: ["c", "a"] })).toBe(false);
		expect(can(trustedChild, "item:create", { assigneeIds: ["a"] })).toBe(false);
	});

	it("un enfant autorisé ne modifie que ce qu'il a créé", () => {
		expect(can(trustedChild, "item:update", { createdBy: "c" })).toBe(true);
		expect(can(trustedChild, "item:update", { createdBy: "a" })).toBe(false);
		expect(can(child, "item:update", { createdBy: "c" })).toBe(false);
		expect(can(adult, "item:update", { createdBy: "c" })).toBe(true);
	});
});

describe("can — compléter et approuver", () => {
	it("chacun valide ses propres éléments, jamais ceux d'un autre", () => {
		for (const actor of [owner, adult, child]) {
			expect(can(actor, "completion:create", { userId: actor.userId })).toBe(true);
			expect(can(actor, "completion:create", { userId: "autre" })).toBe(false);
		}
	});

	it("annuler : sa propre complétion, ou un owner/adulte pour un enfant (l'owner pour tous)", () => {
		expect(can(child, "completion:undo", { userId: "c", userRole: "child" })).toBe(true);
		expect(can(child, "completion:undo", { userId: "a", userRole: "adult" })).toBe(false);
		expect(can(adult, "completion:undo", { userId: "c", userRole: "child" })).toBe(true);
		expect(can(adult, "completion:undo", { userId: "o", userRole: "owner" })).toBe(false);
		expect(can(owner, "completion:undo", { userId: "a", userRole: "adult" })).toBe(true);
	});

	it("annuler un échange d'envie : mêmes droits que pour annuler une validation", () => {
		expect(can(child, "redemption:undo", { userId: "c", userRole: "child" })).toBe(true);
		expect(can(child, "redemption:undo", { userId: "a", userRole: "adult" })).toBe(false);
		expect(can(adult, "redemption:undo", { userId: "c", userRole: "child" })).toBe(true);
		expect(can(adult, "redemption:undo", { userId: "o", userRole: "owner" })).toBe(false);
		expect(can(owner, "redemption:undo", { userId: "a", userRole: "adult" })).toBe(true);
	});

	it("approuver : owner et adulte, jamais un enfant, jamais sa propre complétion", () => {
		expect(can(owner, "completion:approve", { userId: "c" })).toBe(true);
		expect(can(adult, "completion:approve", { userId: "c" })).toBe(true);
		expect(can(child, "completion:approve", { userId: "c2" })).toBe(false);
		expect(can(adult, "completion:approve", { userId: "a" })).toBe(false);
	});

	it("lister les validations à approuver : owner et adulte", () => {
		expect(can(owner, "completion:review")).toBe(true);
		expect(can(adult, "completion:review")).toBe(true);
		expect(can(child, "completion:review")).toBe(false);
	});

	it("jour passé : dans la fenêtre pour tous, au-delà seulement l'owner", () => {
		expect(can(child, "completion:backdate", { daysAgo: 2, windowDays: 2 })).toBe(true);
		expect(can(adult, "completion:backdate", { daysAgo: 3, windowDays: 2 })).toBe(false);
		expect(can(owner, "completion:backdate", { daysAgo: 30, windowDays: 2 })).toBe(true);
	});
});

describe("can — pièces et envies", () => {
	it("envie perso : si on en fait partie (liste vide = tout le monde)", () => {
		expect(can(child, "reward:redeem", { fundedFrom: "personal", assigneeIds: [] })).toBe(true);
		expect(can(child, "reward:redeem", { fundedFrom: "personal", assigneeIds: ["c"] })).toBe(true);
		expect(can(child, "reward:redeem", { fundedFrom: "personal", assigneeIds: ["a"] })).toBe(false);
	});

	it("envie financée par la cagnotte : owner et adulte seulement", () => {
		expect(can(owner, "reward:redeem", { fundedFrom: "shared", assigneeIds: [] })).toBe(true);
		expect(can(adult, "reward:redeem", { fundedFrom: "shared", assigneeIds: [] })).toBe(true);
		expect(can(child, "reward:redeem", { fundedFrom: "shared", assigneeIds: [] })).toBe(false);
	});

	it("gérer les envies : owner et adulte", () => {
		expect(can(adult, "reward:manage")).toBe(true);
		expect(can(child, "reward:manage")).toBe(false);
	});

	it("virement vers la cagnotte : tout membre", () => {
		for (const actor of [owner, adult, child]) expect(can(actor, "transfer:create")).toBe(true);
	});

	it("ajustement manuel et gestion du foyer : owner seul", () => {
		expect(can(owner, "ledger:adjust")).toBe(true);
		expect(can(adult, "ledger:adjust")).toBe(false);
		expect(can(child, "ledger:adjust")).toBe(false);
		expect(can(owner, "household:manage")).toBe(true);
		expect(can(adult, "household:manage")).toBe(false);
	});
});
