// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Schedule } from "./schedule.js";
import { computeStreaks, periodStats } from "./streaks.js";

const counts = (dates: string[], per = 1) => Object.fromEntries(dates.map((d) => [d, per]));
const base = { targetPerDay: 1, weekStart: 1 as const };

describe("computeStreaks — quotidienne", () => {
	const daily: Schedule = { type: "daily" };

	it("aucune complétion : 0 et 0", () => {
		expect(computeStreaks({ ...base, schedule: daily, counts: {}, from: "2026-11-10", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 0,
		});
	});

	it("série actuelle et record distincts", () => {
		const c = counts([
			"2026-11-10",
			"2026-11-11",
			"2026-11-12",
			"2026-11-13",
			"2026-11-14",
			"2026-11-16",
			"2026-11-17",
		]);
		expect(computeStreaks({ ...base, schedule: daily, counts: c, from: "2026-11-10", today: "2026-11-17" })).toEqual({
			current: 2,
			best: 5,
		});
	});

	it("aujourd'hui pas encore fait : la série d'hier reste vivante", () => {
		const c = counts(["2026-11-14", "2026-11-15", "2026-11-16"]);
		expect(computeStreaks({ ...base, schedule: daily, counts: c, from: "2026-11-10", today: "2026-11-17" })).toEqual({
			current: 3,
			best: 3,
		});
	});

	it("un jour manqué hier casse la série actuelle", () => {
		const c = counts(["2026-11-13", "2026-11-14", "2026-11-15"]);
		expect(computeStreaks({ ...base, schedule: daily, counts: c, from: "2026-11-10", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 3,
		});
	});

	it("objectif de 3 par jour : 2 validations ne suffisent pas", () => {
		const c = { "2026-11-15": 3, "2026-11-16": 2, "2026-11-17": 3 };
		expect(
			computeStreaks({
				schedule: daily,
				targetPerDay: 3,
				weekStart: 1,
				counts: c,
				from: "2026-11-15",
				today: "2026-11-17",
			}),
		).toEqual({ current: 1, best: 1 });
	});

	it("ignore ce qui précède la création de l'élément", () => {
		const c = counts(["2026-11-01", "2026-11-02"]);
		expect(computeStreaks({ ...base, schedule: daily, counts: c, from: "2026-11-10", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 0,
		});
	});
});

describe("computeStreaks — jours fixes", () => {
	const mwf: Schedule = { type: "weekly", days: [1, 3, 5] };

	it("ne compte que les jours où l'élément est dû ; les autres jours ne cassent rien", () => {
		// lun 9, mer 11, ven 13, lun 16 faits ; aujourd'hui mardi 17 (non dû)
		const c = counts(["2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16"]);
		expect(computeStreaks({ ...base, schedule: mwf, counts: c, from: "2026-11-09", today: "2026-11-17" })).toEqual({
			current: 4,
			best: 4,
		});
	});

	it("un jour dû manqué casse la série", () => {
		const c = counts(["2026-11-09", "2026-11-13", "2026-11-16"]); // mer 11 manquée
		expect(computeStreaks({ ...base, schedule: mwf, counts: c, from: "2026-11-09", today: "2026-11-17" })).toEqual({
			current: 2,
			best: 2,
		});
	});

	it("une complétion un jour non dû n'ajoute rien", () => {
		const c = counts(["2026-11-17"]);
		expect(computeStreaks({ ...base, schedule: mwf, counts: c, from: "2026-11-16", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 0,
		});
	});
});

describe("computeStreaks — X fois par semaine", () => {
	const three: Schedule = { type: "timesPerWeek", count: 3 };

	it("la période est la semaine ; la semaine en cours ne casse pas la série tant qu'elle est ouverte", () => {
		// semaine du 2/11 : 3 jours (réussie) ; semaine du 9/11 : 3 jours (réussie) ; semaine du 16/11 : 1 jour (en cours)
		const c = counts([
			"2026-11-02",
			"2026-11-04",
			"2026-11-06",
			"2026-11-09",
			"2026-11-10",
			"2026-11-12",
			"2026-11-16",
		]);
		expect(computeStreaks({ ...base, schedule: three, counts: c, from: "2026-11-02", today: "2026-11-17" })).toEqual({
			current: 2,
			best: 2,
		});
	});

	it("une semaine passée sous l'objectif casse la série", () => {
		const c = counts(["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-10"]); // sem. du 9 : 2 jours
		expect(computeStreaks({ ...base, schedule: three, counts: c, from: "2026-11-02", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 1,
		});
	});

	it("la semaine en cours qui atteint l'objectif s'ajoute", () => {
		const c = counts(["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-16", "2026-11-17"]);
		const r = computeStreaks({ ...base, schedule: three, counts: c, from: "2026-11-09", today: "2026-11-18" });
		expect(r.current).toBe(1); // sem. du 9 réussie, sem. du 16 en cours (2/3)
		const done = counts([...Object.keys(c), "2026-11-18"]);
		expect(
			computeStreaks({ ...base, schedule: three, counts: done, from: "2026-11-09", today: "2026-11-18" }).current,
		).toBe(2);
	});

	it("la semaine suit le premier jour choisi par le foyer (dimanche)", () => {
		// Semaine dim 8 → sam 14 : dimanche 8, lundi 9, mardi 10 → réussie avec weekStart = 7
		const c = counts(["2026-11-08", "2026-11-09", "2026-11-10"]);
		expect(
			computeStreaks({
				schedule: three,
				targetPerDay: 1,
				weekStart: 7,
				counts: c,
				from: "2026-11-08",
				today: "2026-11-15",
			}),
		).toEqual({
			current: 1,
			best: 1,
		});
	});
});

describe("computeStreaks — mensuelle", () => {
	it("compte les mois où le jour dû a été validé", () => {
		const monthly: Schedule = { type: "monthly", day: 15 };
		const c = counts(["2026-09-15", "2026-10-15"]);
		expect(computeStreaks({ ...base, schedule: monthly, counts: c, from: "2026-09-01", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 2,
		});
		expect(
			computeStreaks({
				...base,
				schedule: monthly,
				counts: counts([...Object.keys(c), "2026-11-15"]),
				from: "2026-09-01",
				today: "2026-11-17",
			}).current,
		).toBe(3);
	});
});

describe("periodStats (taux)", () => {
	const daily: Schedule = { type: "daily" };

	it("taux sur les jours dus de la plage", () => {
		const c = counts(["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-15", "2026-11-16"]);
		expect(
			periodStats({ ...base, schedule: daily, counts: c, from: "2026-11-11", to: "2026-11-17", today: "2026-11-17" }),
		).toEqual({
			done: 5,
			expected: 6,
			rate: 5 / 6,
		});
	});

	it("aujourd'hui non terminé n'est pas encore un échec", () => {
		const c = counts(["2026-11-16"]);
		expect(
			periodStats({ ...base, schedule: daily, counts: c, from: "2026-11-16", to: "2026-11-17", today: "2026-11-17" }),
		).toEqual({
			done: 1,
			expected: 1,
			rate: 1,
		});
	});

	it("aucun jour dû : taux nul (null)", () => {
		expect(
			periodStats({
				...base,
				schedule: { type: "weekly", days: [1] },
				counts: {},
				from: "2026-11-17",
				to: "2026-11-17",
				today: "2026-11-17",
			}),
		).toEqual({ done: 0, expected: 0, rate: null });
	});

	it("X fois par semaine : attendu = count par semaine entière, fait plafonné à count", () => {
		const c = counts(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]); // 5 jours, objectif 3
		expect(
			periodStats({
				...base,
				schedule: { type: "timesPerWeek", count: 3 },
				counts: c,
				from: "2026-11-16",
				to: "2026-11-22",
				today: "2026-11-22",
			}),
		).toEqual({ done: 3, expected: 3, rate: 1 });
	});
});
