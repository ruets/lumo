// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { highestRole, isRole } from "./roles.js";

describe("roles", () => {
	it("recognises valid roles", () => {
		expect(isRole("owner")).toBe(true);
		expect(isRole("member")).toBe(true);
		expect(isRole("adult")).toBe(false);
		expect(isRole("child")).toBe(false);
		expect(isRole(undefined)).toBe(false);
	});

	it("picks the higher role", () => {
		expect(highestRole("member", "owner")).toBe("owner");
		expect(highestRole("owner", "owner")).toBe("owner");
		expect(highestRole("member", "member")).toBe("member");
	});
});
