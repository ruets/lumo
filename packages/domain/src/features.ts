// SPDX-License-Identifier: AGPL-3.0-or-later
import { DomainError } from "./rules.js";

/**
 * What a household can switch off for itself. A disabled feature is hidden by the clients and refused by the API.
 * The personal space has no toggles.
 */
export const FEATURES = ["pot", "wishes", "habits", "tasks"] as const;
export type Feature = (typeof FEATURES)[number];
export type HouseholdFeatures = Record<Feature, boolean>;

export const DEFAULT_FEATURES: HouseholdFeatures = { pot: true, wishes: true, habits: true, tasks: true };

/** The feature an item of this kind belongs to. */
export const featureOfItem = (kind: "habit" | "task"): Feature => (kind === "habit" ? "habits" : "tasks");

export function assertFeature(features: HouseholdFeatures, feature: Feature): void {
	if (!features[feature]) throw new DomainError("feature_disabled", `This household turned ${feature} off`);
}
