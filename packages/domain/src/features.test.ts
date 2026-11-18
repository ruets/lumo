// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { assertFeature, DEFAULT_FEATURES, FEATURES, featureOfItem } from "./features.js";
import { DomainError } from "./rules.js";

describe("household features", () => {
	it("are all on by default", () => {
		for (const f of FEATURES) expect(DEFAULT_FEATURES[f]).toBe(true);
	});

	it("maps an item kind to its feature", () => {
		expect(featureOfItem("habit")).toBe("habits");
		expect(featureOfItem("task")).toBe("tasks");
	});

	it("refuses a disabled feature with feature_disabled, and only that one", () => {
		const features = { ...DEFAULT_FEATURES, pot: false };
		expect(() => assertFeature(features, "wishes")).not.toThrow();
		try {
			assertFeature(features, "pot");
			throw new Error("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(DomainError);
			expect((e as DomainError).code).toBe("feature_disabled");
		}
	});
});
