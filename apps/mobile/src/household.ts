// SPDX-License-Identifier: AGPL-3.0-or-later
import { readJson, writeJson } from "./store";

/** The household the person is looking at (sent as `X-Household-Id`); the server falls back to their oldest one. */
const KEY = "lumo.household.v1";
let active: string | null = null;
let loading: Promise<void> | null = null;

export function loadActiveHousehold(): Promise<void> {
	loading ??= readJson<string | null>(KEY, null).then((id) => {
		active = id;
	});
	return loading;
}

export const getActiveHouseholdId = (): string | null => active;

export async function setActiveHouseholdId(id: string | null): Promise<void> {
	active = id;
	await writeJson(KEY, id);
}
