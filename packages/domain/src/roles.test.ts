// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { highestRole, isRole, roleAfterOidcLogin } from "./roles.js";

describe("roles", () => {
	it("reconnaît les rôles valides", () => {
		expect(isRole("owner")).toBe(true);
		expect(isRole("admin")).toBe(false);
		expect(isRole(undefined)).toBe(false);
	});

	it("choisit le rôle le plus élevé", () => {
		expect(highestRole("child", "adult")).toBe("adult");
		expect(highestRole("owner", "adult")).toBe("owner");
		expect(highestRole("child", "child")).toBe("child");
	});

	it("promeut en owner via le groupe d'administration, sans jamais rétrograder", () => {
		expect(roleAfterOidcLogin("adult", ["lumo-admins"], "lumo-admins")).toBe("owner");
		expect(roleAfterOidcLogin("adult", ["autre"], "lumo-admins")).toBe("adult");
		expect(roleAfterOidcLogin("owner", [], "lumo-admins")).toBe("owner");
		expect(roleAfterOidcLogin("child", ["lumo-admins"], null)).toBe("child");
	});
});
