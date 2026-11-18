// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { effectiveFilter, hasSeveralSpaces, inSpace, spaceLabel } from "./spaces.js";

const households = [
	{ id: "h1", name: "Maison" },
	{ id: "h2", name: "Flat" },
];

describe("spaces", () => {
	it("filters on all, personal or one household", () => {
		const mine = { householdId: null };
		const shared = { householdId: "h1" };
		expect([inSpace("all", mine), inSpace("all", shared)]).toEqual([true, true]);
		expect([inSpace("personal", mine), inSpace("personal", shared)]).toEqual([true, false]);
		expect([inSpace("h1", mine), inSpace("h1", shared), inSpace("h2", shared)]).toEqual([false, true, false]);
	});

	it("falls back to all when the household is gone", () => {
		expect(effectiveFilter("h2", households)).toBe("h2");
		expect(effectiveFilter("gone", households)).toBe("all");
		expect(effectiveFilter("personal", [])).toBe("personal");
	});

	it("labels items only from two spaces on", () => {
		expect(hasSeveralSpaces([])).toBe(false);
		expect(spaceLabel({ householdId: null }, [], "Personal")).toBeNull();
		expect(spaceLabel({ householdId: null }, households, "Personal")).toBe("Personal");
		expect(spaceLabel({ householdId: "h2" }, households, "Personal")).toBe("Flat");
		expect(spaceLabel({ householdId: "unknown" }, households, "Personal")).toBeNull();
	});
});
