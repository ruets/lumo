// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { DomainError } from "./rules.js";
import { assertCanSupervise, DEFAULT_WARD_RIGHTS, supervisionAllows } from "./supervision.js";

describe("supervisionAllows", () => {
	it("withholds nothing from an unsupervised account", () => {
		for (const a of ["create", "modify", "delete", "transfer"] as const) expect(supervisionAllows(null, a)).toBe(true);
	});

	it("starts strict: only giving to a pot is allowed by default", () => {
		expect(supervisionAllows(DEFAULT_WARD_RIGHTS, "create")).toBe(false);
		expect(supervisionAllows(DEFAULT_WARD_RIGHTS, "modify")).toBe(false);
		expect(supervisionAllows(DEFAULT_WARD_RIGHTS, "delete")).toBe(false);
		expect(supervisionAllows(DEFAULT_WARD_RIGHTS, "transfer")).toBe(true);
	});

	it("follows each right independently", () => {
		const rights = { canCreate: true, canModify: false, canDelete: true, canTransfer: false };
		expect(supervisionAllows(rights, "create")).toBe(true);
		expect(supervisionAllows(rights, "modify")).toBe(false);
		expect(supervisionAllows(rights, "delete")).toBe(true);
		expect(supervisionAllows(rights, "transfer")).toBe(false);
	});
});

describe("assertCanSupervise", () => {
	const ok = {
		guardianId: "g",
		wardId: "w",
		alreadySupervising: false,
		guardianIsSupervised: false,
		wardSupervisesGuardian: false,
	};
	const code = (over: Partial<typeof ok>) => {
		try {
			assertCanSupervise({ ...ok, ...over });
		} catch (e) {
			return e instanceof DomainError ? e.code : "other";
		}
		return null;
	};

	it("accepts a normal supervision", () => expect(code({})).toBeNull());
	it("refuses yourself", () => expect(code({ wardId: "g" })).toBe("cannot_target_self"));
	it("refuses a duplicate", () => expect(code({ alreadySupervising: true })).toBe("already_supervising"));
	it("refuses loops", () => {
		expect(code({ guardianIsSupervised: true })).toBe("guardian_cycle");
		expect(code({ wardSupervisesGuardian: true })).toBe("guardian_cycle");
	});
});
