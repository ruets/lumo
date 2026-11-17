// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { assertRoleChange } from "./household.js";
import { DomainError } from "./rules.js";

const code = (fn: () => void) => {
	try {
		fn();
	} catch (err) {
		return err instanceof DomainError ? err.code : "other";
	}
	return null;
};

describe("assertRoleChange", () => {
	it("allows promoting and demoting a non-owner whatever the number of owners", () => {
		expect(code(() => assertRoleChange({ currentRole: "child", newRole: "adult", ownerCount: 1 }))).toBeNull();
		expect(code(() => assertRoleChange({ currentRole: "adult", newRole: "child", ownerCount: 1 }))).toBeNull();
		expect(code(() => assertRoleChange({ currentRole: "adult", newRole: "owner", ownerCount: 1 }))).toBeNull();
	});

	it("allows demoting an owner while another owner remains", () => {
		expect(code(() => assertRoleChange({ currentRole: "owner", newRole: "adult", ownerCount: 2 }))).toBeNull();
	});

	it("refuses to demote the last owner (last_owner)", () => {
		expect(code(() => assertRoleChange({ currentRole: "owner", newRole: "adult", ownerCount: 1 }))).toBe("last_owner");
		expect(code(() => assertRoleChange({ currentRole: "owner", newRole: "child", ownerCount: 1 }))).toBe("last_owner");
	});

	it("keeping the same role is always fine, even for the last owner", () => {
		expect(code(() => assertRoleChange({ currentRole: "owner", newRole: "owner", ownerCount: 1 }))).toBeNull();
	});
});
