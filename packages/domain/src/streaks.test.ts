// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Schedule } from "./schedule.js";
import { computeStreaks, periodStats } from "./streaks.js";

const counts = (dates: string[], per = 1) => Object.fromEntries(dates.map((d) => [d, per]));
const base = { targetPerDay: 1, weekStart: 1 as const };

describe("computeStreaks — quotidienne", () => {
	const daily: Schedule = { type: "daily" };

	it("no completion: 0 and 0", () => {
		expect(computeStreaks({ ...base, schedule: daily, counts: {}, from: "2026-11-10", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 0,
		});
	});

	it("distinct current and best streaks", () => {
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

	it("today not done yet: yesterday's streak stays alive", () => {
		const c = counts(["2026-11-14", "2026-11-15", "2026-11-16"]);
		expect(computeStreaks({ ...base, schedule: daily, counts: c, from: "2026-11-10", today: "2026-11-17" })).toEqual({
			current: 3,
			best: 3,
		});
	});

	it("a day missed yesterday breaks the current streak", () => {
		const c = counts(["2026-11-13", "2026-11-14", "2026-11-15"]);
		expect(computeStreaks({ ...base, schedule: daily, counts: c, from: "2026-11-10", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 3,
		});
	});

	it("goal of 3 per day: 2 completions are not enough", () => {
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

	it("ignores what precedes the item's creation", () => {
		const c = counts(["2026-11-01", "2026-11-02"]);
		expect(computeStreaks({ ...base, schedule: daily, counts: c, from: "2026-11-10", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 0,
		});
	});
});

describe("computeStreaks — fixed days", () => {
	const mwf: Schedule = { type: "weekly", days: [1, 3, 5] };

	it("only counts the days the item is due; other days break nothing", () => {
		// Mon 9, Wed 11, Fri 13, Mon 16 done; today Tuesday 17 (not due)
		const c = counts(["2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16"]);
		expect(computeStreaks({ ...base, schedule: mwf, counts: c, from: "2026-11-09", today: "2026-11-17" })).toEqual({
			current: 4,
			best: 4,
		});
	});

	it("a missed due day breaks the streak", () => {
		const c = counts(["2026-11-09", "2026-11-13", "2026-11-16"]); // Wed 11 missed
		expect(computeStreaks({ ...base, schedule: mwf, counts: c, from: "2026-11-09", today: "2026-11-17" })).toEqual({
			current: 2,
			best: 2,
		});
	});

	it("a completion on a non-due day adds nothing", () => {
		const c = counts(["2026-11-17"]);
		expect(computeStreaks({ ...base, schedule: mwf, counts: c, from: "2026-11-16", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 0,
		});
	});
});

describe("computeStreaks — X times a week", () => {
	const three: Schedule = { type: "timesPerWeek", count: 3 };

	it("the period is the week; the current week does not break the streak while it is open", () => {
		// week of 11/2: 3 days (successful); week of 11/9: 3 days (successful); week of 11/16: 1 day (in progress)
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

	it("a past week below the goal breaks the streak", () => {
		const c = counts(["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-10"]); // week of the 9th: 2 days
		expect(computeStreaks({ ...base, schedule: three, counts: c, from: "2026-11-02", today: "2026-11-17" })).toEqual({
			current: 0,
			best: 1,
		});
	});

	it("the current week reaching the goal is added", () => {
		const c = counts(["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-16", "2026-11-17"]);
		const r = computeStreaks({ ...base, schedule: three, counts: c, from: "2026-11-09", today: "2026-11-18" });
		expect(r.current).toBe(1); // week of the 9th successful, week of the 16th in progress (2/3)
		const done = counts([...Object.keys(c), "2026-11-18"]);
		expect(
			computeStreaks({ ...base, schedule: three, counts: done, from: "2026-11-09", today: "2026-11-18" }).current,
		).toBe(2);
	});

	it("the week follows the household's chosen first day (Sunday)", () => {
		// Week Sun 8 → Sat 14: Sunday 8, Monday 9, Tuesday 10 → successful with weekStart = 7
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
	it("counts the months where the due day was completed", () => {
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

	it("rate over the range's due days", () => {
		const c = counts(["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-15", "2026-11-16"]);
		expect(
			periodStats({ ...base, schedule: daily, counts: c, from: "2026-11-11", to: "2026-11-17", today: "2026-11-17" }),
		).toEqual({
			done: 5,
			expected: 6,
			rate: 5 / 6,
		});
	});

	it("today not finished is not a failure yet", () => {
		const c = counts(["2026-11-16"]);
		expect(
			periodStats({ ...base, schedule: daily, counts: c, from: "2026-11-16", to: "2026-11-17", today: "2026-11-17" }),
		).toEqual({
			done: 1,
			expected: 1,
			rate: 1,
		});
	});

	it("no due day: null rate", () => {
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

	it("X times a week: expected = count per whole week, done capped at count", () => {
		const c = counts(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]); // 5 days, goal 3
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
