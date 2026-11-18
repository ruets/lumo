// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { assertCanRemoveMember, assertRoleChange } from "./household.js";
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
		expect(code(() => assertRoleChange({ currentRole: "member", newRole: "member", ownerCount: 1 }))).toBeNull();
		expect(code(() => assertRoleChange({ currentRole: "member", newRole: "owner", ownerCount: 1 }))).toBeNull();
	});

	it("allows demoting an owner while another owner remains", () => {
		expect(code(() => assertRoleChange({ currentRole: "owner", newRole: "member", ownerCount: 2 }))).toBeNull();
	});

	it("refuses to demote the last owner (last_owner)", () => {
		expect(code(() => assertRoleChange({ currentRole: "owner", newRole: "member", ownerCount: 1 }))).toBe("last_owner");
	});

	it("keeping the same role is always fine, even for the last owner", () => {
		expect(code(() => assertRoleChange({ currentRole: "owner", newRole: "owner", ownerCount: 1 }))).toBeNull();
	});
});

describe("assertCanRemoveMember", () => {
	const base = { actorId: "alice", targetId: "bob", targetRole: "member" as const, ownerCount: 1 };

	it("allows removing another member", () => {
		expect(code(() => assertCanRemoveMember(base))).toBeNull();
	});

	it("allows removing another owner while at least one owner remains", () => {
		expect(code(() => assertCanRemoveMember({ ...base, targetRole: "owner", ownerCount: 2 }))).toBeNull();
	});

	it("refuses to remove yourself (cannot_remove_self)", () => {
		expect(code(() => assertCanRemoveMember({ ...base, targetId: "alice" }))).toBe("cannot_remove_self");
	});

	it("never removes the last owner (last_owner)", () => {
		expect(code(() => assertCanRemoveMember({ ...base, targetRole: "owner", ownerCount: 1 }))).toBe("last_owner");
	});
});
