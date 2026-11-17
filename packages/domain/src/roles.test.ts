// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { highestRole, isRole, roleAfterOidcLogin } from "./roles.js";

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

	it("promotes to owner via the admin group, never demotes", () => {
		expect(roleAfterOidcLogin("adult", ["lumo-admins"], "lumo-admins")).toBe("owner");
		expect(roleAfterOidcLogin("adult", ["autre"], "lumo-admins")).toBe("adult");
		expect(roleAfterOidcLogin("owner", [], "lumo-admins")).toBe("owner");
		expect(roleAfterOidcLogin("child", ["lumo-admins"], null)).toBe("child");
	});
});
