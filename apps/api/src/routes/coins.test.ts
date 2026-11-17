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

describe("valider : les pièces sont calculées par le serveur, dans la même transaction", () => {
	it("crédite la récompense dans le porte-monnaie perso et écrit au journal", async () => {
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

	it("l'historique nomme l'habitude, l'annulation et l'envie échangée", async () => {
		const item = await makeHabit(h.owner, { name: "Lire", reward: 5 });
		const done = await complete(h.owner, item.id);
		await h.owner.api.del(`/completions/${done.json().completion.id}`);
		await complete(h.owner, item.id);
		const reward = (await h.owner.api.post("/rewards", { name: "Ciné", cost: 3 })).json();
		await h.owner.api.post(`/rewards/${reward.id}/redemptions`);
		const labels = (await h.owner.api.get("/ledger")).json().entries.map((e: { label: string | null }) => e.label);
		// Horloge figée : l'ordre entre écritures simultanées n'est pas défini, on compare sans l'ordre.
		expect([...labels].sort()).toEqual(["Ciné", "Lire", "Lire", "Lire"]);
	});

	it("refuse tout montant envoyé par le client", async () => {
		const item = await makeHabit(h.owner, { reward: 5 });
		const res = await complete(h.owner, item.id, { amount: 1000 });
		expect(res.statusCode).toBe(400);
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
	});

	it("crédite la cagnotte quand l'élément le demande", async () => {
		const item = await makeHabit(h.owner, { reward: 3, creditsTo: "shared" });
		await complete(h.owner, item.id);
		expect(await balances(h.owner)).toEqual({ personal: 0, shared: 3 });
		// la cagnotte est visible par tout le foyer
		expect((await balances(h.kid)).shared).toBe(3);
	});

	it("objectif par jour : 3 validations paient chacune, la 4e est refusée (409 target_reached)", async () => {
		const item = await makeHabit(h.owner, { reward: 2, targetPerPeriod: 3 });
		for (let i = 0; i < 3; i++) expect((await complete(h.owner, item.id)).statusCode).toBe(201);
		const fourth = await complete(h.owner, item.id);
		expect(fourth.statusCode).toBe(409);
		expect(fourth.json().code).toBe("target_reached");
		expect((await balances(h.owner)).personal).toBe(6);
	});

	it("une récompense nulle valide sans écriture", async () => {
		const item = await makeHabit(h.owner, { reward: 0 });
		expect((await complete(h.owner, item.id)).statusCode).toBe(201);
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
	});

	it("on ne valide que ses propres éléments", async () => {
		const forKid = await makeHabit(h.adult, { assigneeIds: [h.kid.userId] });
		const res = await complete(h.owner, forKid.id);
		expect(res.statusCode).toBe(403);
		expect((await complete(h.kid, forKid.id)).statusCode).toBe(201);
	});

	it("un élément archivé ou inconnu ne se valide pas", async () => {
		const item = await makeHabit(h.owner);
		await h.owner.api.del(`/items/${item.id}`);
		expect((await complete(h.owner, item.id)).statusCode).toBe(404);
		expect((await complete(h.owner, "inconnu")).statusCode).toBe(404);
	});

	it("habitude à jours fixes : refusée un jour non dû (409 not_due)", async () => {
		const item = await makeHabit(h.owner, { schedule: { type: "weekly", days: [1, 3, 5] } }); // mardi 17 : pas dû
		const res = await complete(h.owner, item.id);
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("not_due");
	});

	it("tâche ponctuelle : une seule validation, quelle que soit la date", async () => {
		const task = await h.owner.api.post("/items", { kind: "task", name: "Poster le colis", reward: 4 });
		expect((await complete(h.owner, task.json().id)).statusCode).toBe(201);
		expect((await complete(h.owner, task.json().id, { date: "2026-11-16" })).json().code).toBe("target_reached");
	});

	it("la journée est celle du foyer (fuseau Europe/Paris), pas l'UTC", async () => {
		ctx.clock.now = new Date("2026-11-17T23:30:00Z"); // 00:30 le 18 à Paris
		const item = await makeHabit(h.owner);
		expect((await complete(h.owner, item.id)).json().completion.localDate).toBe("2026-11-18");
	});
});

describe("jours passés", () => {
	it("hier et avant-hier passent pour tous (fenêtre par défaut : 2 jours)", async () => {
		const item = await makeHabit(h.adult);
		expect((await complete(h.adult, item.id, { date: "2026-11-16" })).statusCode).toBe(201);
		expect((await complete(h.adult, item.id, { date: "2026-11-15" })).statusCode).toBe(201);
	});

	it("au-delà de la fenêtre : refusé à un adulte, permis à un owner", async () => {
		const mine = await makeHabit(h.adult);
		const res = await complete(h.adult, mine.id, { date: "2026-11-10" });
		expect(res.statusCode).toBe(403);
		expect(res.json().code).toBe("backdate_not_allowed");

		const ownerItem = await makeHabit(h.owner);
		expect((await complete(h.owner, ownerItem.id, { date: "2026-11-10" })).statusCode).toBe(201);
	});

	it("jamais dans le futur", async () => {
		const item = await makeHabit(h.owner);
		const res = await complete(h.owner, item.id, { date: "2026-11-18" });
		expect(res.statusCode).toBe(400);
		expect(res.json().code).toBe("future_date");
	});
});

describe("annuler", () => {
	it("pose undone_at et écrit une contre-écriture (le journal n'est jamais modifié)", async () => {
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

	it("libère la place : on peut revalider après annulation", async () => {
		const item = await makeHabit(h.owner, { reward: 5 });
		const done = (await complete(h.owner, item.id)).json().completion;
		await h.owner.api.del(`/completions/${done.id}`);
		expect((await complete(h.owner, item.id)).statusCode).toBe(201);
		expect((await balances(h.owner)).personal).toBe(5);
	});

	it("rembourse le montant exact payé, même si la récompense a changé depuis", async () => {
		const item = await makeHabit(h.owner, { reward: 5 });
		const done = (await complete(h.owner, item.id)).json().completion;
		await h.owner.api.patch(`/items/${item.id}`, { reward: 50 });
		await h.owner.api.del(`/completions/${done.id}`);
		expect((await balances(h.owner)).personal).toBe(0);
	});

	it("deux annulations : la seconde est refusée (409)", async () => {
		const item = await makeHabit(h.owner);
		const done = (await complete(h.owner, item.id)).json().completion;
		await h.owner.api.del(`/completions/${done.id}`);
		const again = await h.owner.api.del(`/completions/${done.id}`);
		expect(again.statusCode).toBe(409);
		expect(again.json().code).toBe("already_undone");
	});

	it("droits : un enfant n'annule pas la complétion d'un adulte ; un adulte annule celle d'un enfant", async () => {
		const adultItem = await makeHabit(h.adult);
		const adultDone = (await complete(h.adult, adultItem.id)).json().completion;
		expect((await h.kid.api.del(`/completions/${adultDone.id}`)).statusCode).toBe(403);

		const kidItem = await makeHabit(h.adult, { assigneeIds: [h.kid.userId] });
		const kidDone = (await complete(h.kid, kidItem.id)).json().completion;
		expect((await h.adult.api.del(`/completions/${kidDone.id}`)).statusCode).toBe(200);
	});
});

describe("accord d'un adulte", () => {
	let item: { id: string };
	beforeEach(async () => {
		item = await makeHabit(h.adult, { reward: 5, requiresApproval: true, assigneeIds: [h.kid.userId, h.adult.userId] });
	});

	it("enfant : complétion en attente, aucune écriture, aucun solde", async () => {
		const res = await complete(h.kid, item.id);
		expect(res.json().completion.status).toBe("pending");
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
		expect(await balances(h.kid)).toEqual({ personal: 0, shared: 0 });
	});

	it("un adulte sur le même élément est crédité tout de suite", async () => {
		expect((await complete(h.adult, item.id)).json().completion.status).toBe("approved");
		expect((await balances(h.adult)).personal).toBe(5);
	});

	it("l'attente compte pour l'objectif : pas de double envoi", async () => {
		await complete(h.kid, item.id);
		expect((await complete(h.kid, item.id)).json().code).toBe("target_reached");
	});

	it("approuver crée l'écriture dans le porte-monnaie de l'enfant", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		const res = await h.adult.api.post(`/completions/${pending.id}/approve`);
		expect(res.statusCode).toBe(200);
		expect(res.json().completion).toMatchObject({ status: "approved", approvedBy: h.adult.userId });
		expect(await balances(h.kid)).toEqual({ personal: 5, shared: 0 });
		const [entry] = ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.refId, pending.id)).all();
		expect(entry).toMatchObject({ amount: 5, reason: "completion", createdBy: h.adult.userId });
	});

	it("rejeter ne crédite rien", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		const res = await h.adult.api.post(`/completions/${pending.id}/reject`);
		expect(res.json().completion.status).toBe("rejected");
		expect(await balances(h.kid)).toEqual({ personal: 0, shared: 0 });
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
	});

	it("approuver deux fois est refusé (409 not_pending), pas de double crédit", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		await h.adult.api.post(`/completions/${pending.id}/approve`);
		const again = await h.adult.api.post(`/completions/${pending.id}/approve`);
		expect(again.statusCode).toBe(409);
		expect(again.json().code).toBe("not_pending");
		expect((await balances(h.kid)).personal).toBe(5);
	});

	it("un enfant n'approuve pas, ni sa propre complétion", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		expect((await h.kid.api.post(`/completions/${pending.id}/approve`)).statusCode).toBe(403);
	});

	it("les complétions en attente se listent (adultes), et un adulte n'approuve pas la sienne", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		const list = (await h.adult.api.get("/completions?status=pending")).json().completions;
		expect(list.map((c: { id: string }) => c.id)).toEqual([pending.id]);
		expect((await h.kid.api.get("/completions?status=pending")).statusCode).toBe(403);
	});

	it("annuler une complétion en attente ne touche pas au journal", async () => {
		const pending = (await complete(h.kid, item.id)).json().completion;
		expect((await h.kid.api.del(`/completions/${pending.id}`)).statusCode).toBe(200);
		expect(ctx.db.select().from(ledgerEntries).all()).toHaveLength(0);
	});
});

describe("idempotence", () => {
	it("un doublon (même clé) renvoie la même réponse sans second crédit", async () => {
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

	it("une erreur n'est pas mémorisée : on peut réessayer avec la même clé", async () => {
		const item = await makeHabit(h.owner, { reward: 5, schedule: { type: "weekly", days: [1] } });
		const key = { "idempotency-key": "22222222-2222-4222-8222-222222222222" };
		expect((await h.owner.api.post(`/items/${item.id}/completions`, {}, key)).statusCode).toBe(409);
		ctx.clock.now = new Date("2026-11-16T10:00:00Z"); // lundi : devient dû
		expect((await h.owner.api.post(`/items/${item.id}/completions`, {}, key)).statusCode).toBe(201);
	});

	it("la clé est propre à chaque utilisateur", async () => {
		const mine = await makeHabit(h.owner, { assigneeIds: [h.owner.userId, h.adult.userId] });
		const key = { "idempotency-key": "33333333-3333-4333-8333-333333333333" };
		expect((await h.owner.api.post(`/items/${mine.id}/completions`, {}, key)).statusCode).toBe(201);
		const other = await h.adult.api.post(`/items/${mine.id}/completions`, {}, key);
		expect(other.statusCode).toBe(201);
		expect(other.headers["idempotent-replayed"]).toBeUndefined();
	});
});

describe("virements perso → cagnotte", () => {
	beforeEach(async () => {
		await complete(h.kid, (await makeHabit(h.adult, { reward: 5, assigneeIds: [h.kid.userId] })).id);
	});

	it("deux écritures opposées liées par le même transfer_id, dans la même transaction", async () => {
		const res = await h.kid.api.post("/transfers", { amount: 3 });
		expect(res.statusCode).toBe(201);
		expect(res.json().balances).toEqual({ personal: 2, shared: 3 });
		const entries = ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.reason, "transfer")).all();
		expect(entries).toHaveLength(2);
		expect(entries.map((e) => e.amount).sort()).toEqual([-3, 3]);
		expect(new Set(entries.map((e) => e.transferId)).size).toBe(1);
		expect(entries[0]?.transferId).toBe(res.json().transferId);
	});

	it("solde insuffisant : 409, rien n'est écrit", async () => {
		const res = await h.kid.api.post("/transfers", { amount: 6 });
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("insufficient_balance");
		expect(ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.reason, "transfer")).all()).toHaveLength(0);
	});

	it("autorise de tout virer ; refuse 0, négatif, décimal", async () => {
		expect((await h.kid.api.post("/transfers", { amount: 5 })).statusCode).toBe(201);
		for (const amount of [0, -2, 1.5]) {
			expect((await h.kid.api.post("/transfers", { amount })).statusCode).toBe(400);
		}
	});
});

describe("envies et échanges", () => {
	const makeReward = (by: { api: Api }, over: object = {}) =>
		by.api.post("/rewards", { name: "Cinéma", cost: 4, fundedFrom: "personal", ...over });

	beforeEach(async () => {
		const item = await makeHabit(h.adult, { reward: 5, assigneeIds: [h.kid.userId] });
		await complete(h.kid, item.id);
	});

	it("seuls owner et adulte créent des envies", async () => {
		expect((await makeReward(h.kid)).statusCode).toBe(403);
		const res = await makeReward(h.adult, { description: "Soirée film", link: "https://example.org/film" });
		expect(res.statusCode).toBe(201);
		expect(res.json()).toMatchObject({
			name: "Cinéma",
			cost: 4,
			fundedFrom: "personal",
			limitCount: null,
			assigneeIds: [],
		});
	});

	it("exige un prix d'au moins 1 pièce et une limite cohérente", async () => {
		expect((await makeReward(h.adult, { cost: 0 })).statusCode).toBe(400);
		expect((await makeReward(h.adult, { limitCount: 2 })).statusCode).toBe(400);
		expect((await makeReward(h.adult, { limitCount: 2, limitPeriod: "week" })).statusCode).toBe(201);
	});

	it("échanger débite le prix et enregistre l'échange avec son écriture", async () => {
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

	it("solde insuffisant : 409 insufficient_balance", async () => {
		const reward = (await makeReward(h.adult, { cost: 6 })).json();
		const res = await h.kid.api.post(`/rewards/${reward.id}/redemptions`);
		expect(res.statusCode).toBe(409);
		expect(res.json().code).toBe("insufficient_balance");
	});

	it("limite d'usage par période : 1 par semaine, puis de nouveau possible la semaine suivante", async () => {
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
		ctx.clock.now = new Date("2026-11-24T10:00:00Z"); // semaine suivante
		expect(await remaining()).toBe(1);
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(201);
	});

	it("envie financée par la cagnotte : réservée aux adultes, débite la cagnotte", async () => {
		await h.kid.api.post("/transfers", { amount: 5 });
		const reward = (await makeReward(h.adult, { cost: 3, fundedFrom: "shared" })).json();
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(403);
		const res = await h.adult.api.post(`/rewards/${reward.id}/redemptions`);
		expect(res.statusCode).toBe(201);
		expect(res.json().balances.shared).toBe(2);
	});

	it("envie réservée à certains membres", async () => {
		const reward = (await makeReward(h.adult, { assigneeIds: [h.adult.userId] })).json();
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(403);
	});

	it("envie archivée : plus échangeable, et absente de la liste", async () => {
		const reward = (await makeReward(h.adult)).json();
		await h.adult.api.patch(`/rewards/${reward.id}`, { archived: true });
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(404);
		expect((await h.kid.api.get("/rewards")).json().rewards).toHaveLength(0);
	});

	it("modifier une envie : adultes seulement", async () => {
		const reward = (await makeReward(h.adult)).json();
		expect((await h.kid.api.patch(`/rewards/${reward.id}`, { cost: 1 })).statusCode).toBe(403);
		expect((await h.adult.api.patch(`/rewards/${reward.id}`, { cost: 9 })).json().cost).toBe(9);
	});
});

describe("annuler un échange d'envie", () => {
	const makeReward = (over: object = {}) =>
		h.adult.api.post("/rewards", { name: "Cinéma", cost: 4, fundedFrom: "personal", ...over });
	const redeem = async (by: { api: Api }, rewardId: string) =>
		(await by.api.post(`/rewards/${rewardId}/redemptions`)).json().redemption.id as string;

	beforeEach(async () => {
		const item = await makeHabit(h.adult, { reward: 10, assigneeIds: [h.kid.userId] });
		await complete(h.kid, item.id);
	});

	it("rembourse le montant exact par une contre-écriture, sans toucher au journal existant", async () => {
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

	it("deux annulations simultanées : un seul remboursement", async () => {
		const reward = (await makeReward()).json();
		const id = await redeem(h.kid, reward.id);
		const [a, b] = await Promise.all([h.kid.api.del(`/redemptions/${id}`), h.kid.api.del(`/redemptions/${id}`)]);
		expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
		expect(await balances(h.kid)).toEqual({ personal: 10, shared: 0 });
	});

	it("rembourse ce qui a été payé, même si le prix a changé depuis", async () => {
		const reward = (await makeReward()).json();
		const id = await redeem(h.kid, reward.id);
		await h.adult.api.patch(`/rewards/${reward.id}`, { cost: 9 });
		expect((await h.kid.api.del(`/redemptions/${id}`)).json().balances.personal).toBe(10);
	});

	it("une seconde annulation est refusée (409), pas de double remboursement", async () => {
		const reward = (await makeReward()).json();
		const id = await redeem(h.kid, reward.id);
		await h.kid.api.del(`/redemptions/${id}`);
		const again = await h.kid.api.del(`/redemptions/${id}`);
		expect(again.statusCode).toBe(409);
		expect(again.json().code).toBe("already_undone");
		expect(await balances(h.kid)).toEqual({ personal: 10, shared: 0 });
	});

	it("libère la limite d'usage : on peut de nouveau échanger", async () => {
		const reward = (await makeReward({ cost: 1, limitCount: 1, limitPeriod: "week" })).json();
		const id = await redeem(h.kid, reward.id);
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).json().code).toBe("limit_reached");
		await h.kid.api.del(`/redemptions/${id}`);
		const listed = (await h.kid.api.get("/rewards")).json().rewards.find((r: { id: string }) => r.id === reward.id);
		expect(listed.remaining).toBe(1);
		expect((await h.kid.api.post(`/rewards/${reward.id}/redemptions`)).statusCode).toBe(201);
	});

	it("envie financée par la cagnotte : rembourse la cagnotte", async () => {
		await h.kid.api.post("/transfers", { amount: 6 });
		const reward = (await makeReward({ cost: 5, fundedFrom: "shared" })).json();
		const id = await redeem(h.adult, reward.id);
		expect((await balances(h.adult)).shared).toBe(1);
		expect((await h.adult.api.del(`/redemptions/${id}`)).json().balances.shared).toBe(6);
	});

	it("droits : un enfant n'annule pas l'échange d'un adulte ; un adulte annule celui d'un enfant", async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: h.adult.userId, amount: 20, note: "test" });
		const cheap = (await makeReward({ cost: 1 })).json();
		const adults = await redeem(h.adult, cheap.id);
		expect((await h.kid.api.del(`/redemptions/${adults}`)).statusCode).toBe(403);
		const kids = await redeem(h.kid, cheap.id);
		expect((await h.adult.api.del(`/redemptions/${kids}`)).statusCode).toBe(200);
	});

	it("introuvable : 404", async () => {
		expect((await h.kid.api.del("/redemptions/inconnu")).statusCode).toBe(404);
	});

	it("l'historique nomme l'envie sur la ligne de remboursement", async () => {
		const reward = (await makeReward({ name: "Glace" })).json();
		const id = await redeem(h.kid, reward.id);
		await h.kid.api.del(`/redemptions/${id}`);
		const entries = (await h.kid.api.get("/ledger")).json().entries;
		expect(entries.find((e: { reason: string }) => e.reason === "undo")).toMatchObject({ label: "Glace", amount: 4 });
	});
});

describe("journal et ajustements", () => {
	it("ajustement manuel : owner seulement, note obligatoire, positif ou négatif", async () => {
		const ok = await h.owner.api.post("/ledger/adjustments", {
			userId: h.kid.userId,
			amount: 10,
			note: "Récompense exceptionnelle",
		});
		expect(ok.statusCode).toBe(201);
		expect(ok.json().entry).toMatchObject({
			amount: 10,
			reason: "adjustment",
			note: "Récompense exceptionnelle",
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

	it("ajuste la cagnotte avec userId null", async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: null, amount: 7, note: "Don" });
		expect((await balances(h.kid)).shared).toBe(7);
	});

	it("historique paginé par curseur, du plus récent au plus ancien, sans doublon ni trou", async () => {
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

	it("chacun ne lit que son porte-monnaie et la cagnotte ; le solde est la somme du journal", async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: 8, note: "a" });
		await h.owner.api.post("/ledger/adjustments", { userId: h.owner.userId, amount: 3, note: "b" });
		const mine = (await h.kid.api.get("/ledger?wallet=personal")).json();
		expect(mine.entries).toHaveLength(1);
		expect(mine.balance).toBe(8);
		expect((await h.kid.api.get("/ledger?wallet=shared")).json().entries).toHaveLength(0);
		expect((await h.kid.api.get("/ledger?wallet=autre")).statusCode).toBe(400);
	});
});
