// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
	assertCanLeaveHousehold,
	assertInstanceAccessChange,
	canManageInstance,
	isSuperAdminAfterOidcLogin,
} from "./accounts.js";
import { DomainError } from "./rules.js";

const code = (fn: () => void) => {
	try {
		fn();
	} catch (err) {
		return err instanceof DomainError ? err.code : "other";
	}
	return null;
};

describe("canManageInstance", () => {
	it("only super admins manage the instance", () => {
		expect(canManageInstance({ isSuperAdmin: true })).toBe(true);
		expect(canManageInstance({ isSuperAdmin: false })).toBe(false);
	});
});

describe("isSuperAdminAfterOidcLogin", () => {
	it("members of the admin group become super admins, and it never demotes", () => {
		expect(isSuperAdminAfterOidcLogin(false, ["family-admins"], "family-admins")).toBe(true);
		expect(isSuperAdminAfterOidcLogin(false, ["other"], "family-admins")).toBe(false);
		expect(isSuperAdminAfterOidcLogin(true, [], "family-admins")).toBe(true);
	});

	it("nobody is promoted when no admin group is configured", () => {
		expect(isSuperAdminAfterOidcLogin(false, ["family-admins"], null)).toBe(false);
		expect(isSuperAdminAfterOidcLogin(true, [], null)).toBe(true);
	});
});

describe("assertInstanceAccessChange", () => {
	const base = { actorId: "root", targetId: "bob", targetIsSuperAdmin: false, superAdminCount: 1 };

	it("allows acting on a regular account", () => {
		for (const action of ["disable", "delete", "demote"] as const) {
			expect(code(() => assertInstanceAccessChange({ ...base, action }))).toBeNull();
		}
	});

	it("never disables or deletes yourself (cannot_target_self)", () => {
		for (const action of ["disable", "delete"] as const) {
			expect(
				code(() =>
					assertInstanceAccessChange({
						...base,
						action,
						targetId: "root",
						targetIsSuperAdmin: true,
						superAdminCount: 2,
					}),
				),
			).toBe("cannot_target_self");
		}
	});

	it("a super admin can step down while another one remains", () => {
		expect(
			code(() =>
				assertInstanceAccessChange({
					...base,
					action: "demote",
					targetId: "root",
					targetIsSuperAdmin: true,
					superAdminCount: 2,
				}),
			),
		).toBeNull();
	});

	it("never removes the last super admin (last_super_admin)", () => {
		for (const action of ["disable", "delete", "demote"] as const) {
			expect(
				code(() => assertInstanceAccessChange({ ...base, action, targetIsSuperAdmin: true, superAdminCount: 1 })),
			).toBe("last_super_admin");
		}
	});

	it("allows removing another super admin when two exist", () => {
		for (const action of ["disable", "delete", "demote"] as const) {
			expect(
				code(() => assertInstanceAccessChange({ ...base, action, targetIsSuperAdmin: true, superAdminCount: 2 })),
			).toBeNull();
		}
	});
});

describe("assertCanLeaveHousehold", () => {
	it("anyone can leave, except the last owner (last_owner)", () => {
		expect(code(() => assertCanLeaveHousehold({ role: "member", ownerCount: 1 }))).toBeNull();
		expect(code(() => assertCanLeaveHousehold({ role: "adult", ownerCount: 1 }))).toBeNull();
		expect(code(() => assertCanLeaveHousehold({ role: "owner", ownerCount: 2 }))).toBeNull();
		expect(code(() => assertCanLeaveHousehold({ role: "owner", ownerCount: 1 }))).toBe("last_owner");
	});
});
