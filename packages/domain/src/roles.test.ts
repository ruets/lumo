// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { highestRole, isRole } from "./roles.js";

describe("roles", () => {
	it("recognises valid roles", () => {
		expect(isRole("owner")).toBe(true);
		expect(isRole("admin")).toBe(false);
		expect(isRole(undefined)).toBe(false);
	});

	it("picks the higher role", () => {
		expect(highestRole("child", "adult")).toBe("adult");
		expect(highestRole("owner", "adult")).toBe("owner");
		expect(highestRole("child", "child")).toBe("child");
	});
});
