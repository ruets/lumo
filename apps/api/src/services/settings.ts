// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from "drizzle-orm";
import { instanceSettings } from "../db/schema.js";
import type { DbOrTx, Tx } from "./members.js";

export interface InstanceSettings {
	/** Who may create a household: any account, or super admins only. */
	householdCreation: "anyone" | "admins";
}

const DEFAULTS: InstanceSettings = { householdCreation: "anyone" };

export function getSettings(db: DbOrTx): InstanceSettings {
	const row = db.select().from(instanceSettings).where(eq(instanceSettings.key, "household_creation")).get();
	return { householdCreation: row?.value === "admins" ? "admins" : DEFAULTS.householdCreation };
}

export function updateSettings(tx: Tx, input: Partial<InstanceSettings>): InstanceSettings {
	if (input.householdCreation !== undefined) {
		tx.insert(instanceSettings)
			.values({ key: "household_creation", value: input.householdCreation })
			.onConflictDoUpdate({ target: instanceSettings.key, set: { value: input.householdCreation } })
			.run();
	}
	return getSettings(tx);
}
