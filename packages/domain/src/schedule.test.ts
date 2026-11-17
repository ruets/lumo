// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { isDue, type Schedule, scheduleSchema } from "./schedule.js";

describe("scheduleSchema", () => {
	it("accepts the four schedule types", () => {
		expect(scheduleSchema.parse({ type: "daily" })).toEqual({ type: "daily" });
		expect(scheduleSchema.parse({ type: "weekly", days: [1, 3, 5] })).toEqual({ type: "weekly", days: [1, 3, 5] });
		expect(scheduleSchema.parse({ type: "timesPerWeek", count: 3 })).toEqual({ type: "timesPerWeek", count: 3 });
		expect(scheduleSchema.parse({ type: "monthly", day: 15 })).toEqual({ type: "monthly", day: 15 });
	});

	it("rejects out-of-range or inconsistent values", () => {
		expect(scheduleSchema.safeParse({ type: "weekly", days: [] }).success).toBe(false);
		expect(scheduleSchema.safeParse({ type: "weekly", days: [0] }).success).toBe(false);
		expect(scheduleSchema.safeParse({ type: "weekly", days: [8] }).success).toBe(false);
		expect(scheduleSchema.safeParse({ type: "weekly", days: [1, 1] }).success).toBe(false);
		expect(scheduleSchema.safeParse({ type: "timesPerWeek", count: 0 }).success).toBe(false);
		expect(scheduleSchema.safeParse({ type: "timesPerWeek", count: 8 }).success).toBe(false);
		expect(scheduleSchema.safeParse({ type: "monthly", day: 32 }).success).toBe(false);
		expect(scheduleSchema.safeParse({ type: "rrule", rule: "FREQ=DAILY" }).success).toBe(false);
	});
});

describe("isDue", () => {
	it("daily: every day", () => {
		expect(isDue({ type: "daily" }, "2026-11-17")).toBe(true);
	});

	it("fixed days: only the listed days (1 = Monday)", () => {
		const s: Schedule = { type: "weekly", days: [1, 3, 5] };
		expect(isDue(s, "2026-11-16")).toBe(true); // lundi
		expect(isDue(s, "2026-11-17")).toBe(false); // mardi
		expect(isDue(s, "2026-11-18")).toBe(true); // mercredi
	});

	it("X times a week: offered every day (the member chooses)", () => {
		const s = { type: "timesPerWeek", count: 3 } as const;
		expect(isDue(s, "2026-11-17")).toBe(true);
		expect(isDue(s, "2026-11-22")).toBe(true);
	});

	it("monthly: the day of the month, brought back to the last day if the month is shorter", () => {
		const s = { type: "monthly", day: 31 } as const;
		expect(isDue(s, "2026-01-31")).toBe(true);
		expect(isDue(s, "2026-02-28")).toBe(true);
		expect(isDue(s, "2026-02-27")).toBe(false);
		expect(isDue(s, "2028-02-29")).toBe(true);
		expect(isDue(s, "2026-04-30")).toBe(true);
		expect(isDue({ type: "monthly", day: 15 }, "2026-11-15")).toBe(true);
		expect(isDue({ type: "monthly", day: 15 }, "2026-11-16")).toBe(false);
	});
});
