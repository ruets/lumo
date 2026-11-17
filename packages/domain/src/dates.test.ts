// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { addDays, compareDates, daysBetween, daysInMonth, isoWeekday, localDate, startOfWeek } from "./dates.js";

describe("localDate (the household's local day)", () => {
	it("converts a UTC instant to the household's time zone", () => {
		expect(localDate(new Date("2026-11-17T23:30:00Z"), "Europe/Paris")).toBe("2026-11-18");
		expect(localDate(new Date("2026-11-17T23:30:00Z"), "America/New_York")).toBe("2026-11-17");
	});

	it("switch to summer time (March 29, 2026, 01:00 UTC)", () => {
		expect(localDate(new Date("2026-03-28T23:30:00Z"), "Europe/Paris")).toBe("2026-03-29");
		expect(localDate(new Date("2026-03-29T00:59:00Z"), "Europe/Paris")).toBe("2026-03-29");
		expect(localDate(new Date("2026-03-29T23:30:00Z"), "Europe/Paris")).toBe("2026-03-30");
	});

	it("switch to winter time (October 25, 2026, 01:00 UTC): the 25th lasts 25 h", () => {
		expect(localDate(new Date("2026-10-24T22:00:00Z"), "Europe/Paris")).toBe("2026-10-25");
		expect(localDate(new Date("2026-10-25T22:59:00Z"), "Europe/Paris")).toBe("2026-10-25");
		expect(localDate(new Date("2026-10-25T23:00:00Z"), "Europe/Paris")).toBe("2026-10-26");
	});

	it("refuse un fuseau inconnu", () => {
		expect(() => localDate(new Date(), "Mars/Olympus")).toThrow();
	});
});

describe("calendar date arithmetic", () => {
	it("addDays crosses months, years and leap years", () => {
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
		expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(addDays("2026-11-17", 0)).toBe("2026-11-17");
	});

	it("addDays is not affected by daylight-saving changes", () => {
		expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
		expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
	});

	it("daysBetween counts whole days", () => {
		expect(daysBetween("2026-11-10", "2026-11-17")).toBe(7);
		expect(daysBetween("2026-11-17", "2026-11-10")).toBe(-7);
		expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
	});

	it("isoWeekday : 1 = lundi … 7 = dimanche", () => {
		expect(isoWeekday("2026-11-16")).toBe(1);
		expect(isoWeekday("2026-11-17")).toBe(2);
		expect(isoWeekday("2026-11-22")).toBe(7);
	});

	it("startOfWeek respects the household's first day of the week", () => {
		expect(startOfWeek("2026-11-17", 1)).toBe("2026-11-16");
		expect(startOfWeek("2026-11-16", 1)).toBe("2026-11-16");
		expect(startOfWeek("2026-11-15", 1)).toBe("2026-11-09");
		expect(startOfWeek("2026-11-17", 7)).toBe("2026-11-15");
		expect(startOfWeek("2026-11-15", 7)).toBe("2026-11-15");
	});

	it("daysInMonth handles a leap-year February", () => {
		expect(daysInMonth("2026-02-10")).toBe(28);
		expect(daysInMonth("2028-02-10")).toBe(29);
		expect(daysInMonth("2026-11-01")).toBe(30);
	});

	it("compareDates ordonne lexicographiquement", () => {
		expect(compareDates("2026-11-17", "2026-11-18")).toBeLessThan(0);
		expect(compareDates("2026-11-17", "2026-11-17")).toBe(0);
	});

	it("rejects a malformed date", () => {
		expect(() => addDays("17/11/2026", 1)).toThrow();
		expect(() => addDays("2026-02-30", 1)).toThrow();
	});
});
