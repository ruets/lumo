// SPDX-License-Identifier: AGPL-3.0-or-later
import { Worker } from "node:worker_threads";
import { count, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { openDatabase } from "../db/client.js";
import { completions, ledgerEntries, redemptions } from "../db/schema.js";
import { api, balances, createHousehold, createTestContext, makeHabit, type TestContext } from "../test/helpers.js";

let ctx: TestContext;
let h: Awaited<ReturnType<typeof createHousehold>>;
beforeEach(async () => {
	ctx = await createTestContext();
	h = await createHousehold(ctx);
});
afterEach(async () => {
	await ctx.close();
});

const statuses = (responses: { statusCode: number }[]) => responses.map((r) => r.statusCode);
const tally = (codes: number[]) => {
	const out: Record<number, number> = {};
	for (const c of codes) out[c] = (out[c] ?? 0) + 1;
	return out;
};
const ledgerRows = () => ctx.db.select({ n: count() }).from(ledgerEntries).get()?.n;

describe("critère de l'étape 2 : 20 validations simultanées donnent le bon solde", () => {
	it("objectif de 20 : les 20 passent, le solde est exactement 20 × la récompense", async () => {
		const item = await makeHabit(h.owner, { reward: 3, targetPerPeriod: 20 });
		const responses = await Promise.all(
			Array.from({ length: 20 }, () => h.owner.api.post(`/items/${item.id}/completions`)),
		);
		expect(tally(statuses(responses))).toEqual({ 201: 20 });
		expect(await balances(h.owner)).toEqual({ personal: 60, shared: 0 });
		expect(ledgerRows()).toBe(20);
		expect(ctx.db.select({ n: count() }).from(completions).get()?.n).toBe(20);
	});

	it("objectif de 5 : exactement 5 réussissent, 15 reçoivent 409, solde = 5 × récompense", async () => {
		const item = await makeHabit(h.owner, { reward: 3, targetPerPeriod: 5 });
		const responses = await Promise.all(
			Array.from({ length: 20 }, () => h.owner.api.post(`/items/${item.id}/completions`)),
		);
		expect(tally(statuses(responses))).toEqual({ 201: 5, 409: 15 });
		expect(responses.filter((r) => r.statusCode === 409).every((r) => r.json().code === "target_reached")).toBe(true);
		expect((await balances(h.owner)).personal).toBe(15);
		expect(ledgerRows()).toBe(5);
	});

	it("deux instances de l'API sur le même fichier SQLite (deux connexions) : même résultat", async () => {
		const { db, sqlite } = openDatabase(ctx.dbPath);
		const second = await buildApp({ config: ctx.config, db, oidc: null, clock: () => ctx.clock.now });
		await second.ready();
		try {
			const other = api({ ...ctx, app: second }, h.owner.cookie);
			const item = await makeHabit(h.owner, { reward: 2, targetPerPeriod: 8 });
			const responses = await Promise.all(
				Array.from({ length: 20 }, (_, i) => (i % 2 ? other : h.owner.api).post(`/items/${item.id}/completions`)),
			);
			expect(tally(statuses(responses))).toEqual({ 201: 8, 409: 12 });
			expect((await balances(h.owner)).personal).toBe(16);
		} finally {
			await second.close();
			sqlite.close();
		}
	});

	it("20 validations rejouées avec la même Idempotency-Key : une seule écriture", async () => {
		const item = await makeHabit(h.owner, { reward: 5, targetPerPeriod: 50 });
		const key = { "idempotency-key": "44444444-4444-4444-8444-444444444444" };
		const responses = await Promise.all(
			Array.from({ length: 20 }, () => h.owner.api.post(`/items/${item.id}/completions`, {}, key)),
		);
		expect(tally(statuses(responses))).toEqual({ 201: 20 });
		expect(new Set(responses.map((r) => r.json().completion.id)).size).toBe(1);
		expect((await balances(h.owner)).personal).toBe(5);
		expect(ledgerRows()).toBe(1);
	});
});

/** Lance `threads` threads, chacun avec sa connexion SQLite, qui tirent leurs requêtes en même temps. */
async function race(opts: { threads: number; perThread: number; cookie: string; url: string; payload?: object }) {
	const workers = Array.from(
		{ length: opts.threads },
		() =>
			new Worker(new URL("../test/race-worker.ts", import.meta.url), {
				execArgv: ["--import", "tsx"],
				workerData: {
					dbPath: ctx.dbPath,
					config: ctx.config,
					cookie: opts.cookie,
					url: opts.url,
					payload: opts.payload ?? {},
					count: opts.perThread,
					now: ctx.clock.now.toISOString(),
				},
			}),
	);
	const results = workers.map(
		(w) =>
			new Promise<number[]>((resolve, reject) => {
				w.once("message", (codes: number[]) => resolve(codes));
				w.once("error", reject);
			}),
	);
	await new Promise((r) => setTimeout(r, 1500)); // laisse chaque thread ouvrir sa connexion et migrer
	for (const w of workers) w.postMessage("go");
	const codes = (await Promise.all(results)).flat();
	await Promise.all(workers.map((w) => w.terminate()));
	return codes;
}

describe("vraie concurrence : plusieurs connexions SQLite en parallèle (threads)", () => {
	it("4 threads × 5 validations sur un objectif de 7 : exactement 7 réussites, solde exact", async () => {
		const item = await makeHabit(h.owner, { reward: 3, targetPerPeriod: 7 });
		const codes = await race({
			threads: 4,
			perThread: 5,
			cookie: h.owner.cookie,
			url: `/items/${item.id}/completions`,
		});
		expect(tally(codes)).toEqual({ 201: 7, 409: 13 });
		expect((await balances(h.owner)).personal).toBe(21);
		expect(ledgerRows()).toBe(7);
	}, 30_000);

	it("5 threads qui virent 4 pièces chacun avec 10 en poche : 2 virements, jamais de solde négatif", async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: 10, note: "départ" });
		const codes = await race({
			threads: 5,
			perThread: 1,
			cookie: h.kid.cookie,
			url: "/transfers",
			payload: { amount: 4 },
		});
		expect(tally(codes)).toEqual({ 201: 2, 409: 3 });
		expect(await balances(h.kid)).toEqual({ personal: 2, shared: 8 });
	}, 30_000);
});

describe("autres écritures de pièces sous concurrence", () => {
	beforeEach(async () => {
		await h.owner.api.post("/ledger/adjustments", { userId: h.kid.userId, amount: 10, note: "départ" });
	});

	it("échanges : jamais de solde négatif (10 pièces, prix 4, 5 tentatives → 2 réussites)", async () => {
		const reward = (await h.adult.api.post("/rewards", { name: "Glace", cost: 4, fundedFrom: "personal" })).json();
		const responses = await Promise.all(
			Array.from({ length: 5 }, () => h.kid.api.post(`/rewards/${reward.id}/redemptions`)),
		);
		expect(tally(statuses(responses))).toEqual({ 201: 2, 409: 3 });
		expect((await balances(h.kid)).personal).toBe(2);
		expect(ctx.db.select({ n: count() }).from(redemptions).get()?.n).toBe(2);
	});

	it("limite d'usage : 1 par semaine tient sous 5 tentatives simultanées", async () => {
		const reward = (
			await h.adult.api.post("/rewards", {
				name: "Jeu",
				cost: 1,
				fundedFrom: "personal",
				limitCount: 1,
				limitPeriod: "week",
			})
		).json();
		const responses = await Promise.all(
			Array.from({ length: 5 }, () => h.kid.api.post(`/rewards/${reward.id}/redemptions`)),
		);
		expect(tally(statuses(responses))).toEqual({ 201: 1, 409: 4 });
		expect((await balances(h.kid)).personal).toBe(9);
	});

	it("virements : jamais plus que le solde, et la somme des deux porte-monnaie est conservée", async () => {
		const responses = await Promise.all(Array.from({ length: 5 }, () => h.kid.api.post("/transfers", { amount: 4 })));
		expect(tally(statuses(responses))).toEqual({ 201: 2, 409: 3 });
		expect(await balances(h.kid)).toEqual({ personal: 2, shared: 8 });
	});

	it("approbation simultanée d'une même complétion : un seul crédit", async () => {
		const item = await makeHabit(h.adult, { reward: 5, requiresApproval: true, assigneeIds: [h.kid.userId] });
		const pending = (await h.kid.api.post(`/items/${item.id}/completions`)).json().completion;
		const responses = await Promise.all([
			...Array.from({ length: 3 }, () => h.adult.api.post(`/completions/${pending.id}/approve`)),
			...Array.from({ length: 3 }, () => h.owner.api.post(`/completions/${pending.id}/approve`)),
		]);
		expect(tally(statuses(responses))).toEqual({ 200: 1, 409: 5 });
		expect((await balances(h.kid)).personal).toBe(15); // 10 de départ + 5
	});

	it("annulation simultanée : un seul remboursement", async () => {
		const item = await makeHabit(h.kid.api ? h.adult : h.adult, { reward: 5, assigneeIds: [h.kid.userId] });
		const done = (await h.kid.api.post(`/items/${item.id}/completions`)).json().completion;
		const responses = await Promise.all(Array.from({ length: 6 }, () => h.kid.api.del(`/completions/${done.id}`)));
		expect(tally(statuses(responses))).toEqual({ 200: 1, 409: 5 });
		expect((await balances(h.kid)).personal).toBe(10);
	});

	it("invariant : le solde de chaque porte-monnaie égale la somme de ses écritures", async () => {
		const item = await makeHabit(h.kid.api ? h.adult : h.adult, {
			reward: 3,
			targetPerPeriod: 10,
			assigneeIds: [h.kid.userId],
		});
		await Promise.all([
			...Array.from({ length: 10 }, () => h.kid.api.post(`/items/${item.id}/completions`)),
			...Array.from({ length: 4 }, () => h.kid.api.post("/transfers", { amount: 5 })),
		]);
		const sums = ctx.db
			.select({ total: sql<number>`sum(${ledgerEntries.amount})` })
			.from(ledgerEntries)
			.get();
		const b = await balances(h.kid);
		const own = ctx.sqlite.prepare("SELECT sum(amount) AS s FROM ledger_entries").get() as { s: number };
		// kid + cagnotte + autres porte-monnaie (owner/adult : aucun) = total du journal
		expect(b.personal + b.shared).toBe(own.s);
		expect(sums?.total).toBe(own.s);
		expect(b.personal).toBeGreaterThanOrEqual(0);
	});
});
