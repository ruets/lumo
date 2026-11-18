// SPDX-License-Identifier: AGPL-3.0-or-later

/** The household the person is looking at (sent as `X-Household-Id`); the server falls back to their oldest one. */
const KEY = "lumo.household";

function read(): string | null {
	try {
		return window.localStorage.getItem(KEY);
	} catch {
		return null;
	}
}

let active: string | null = read();

export const getActiveHouseholdId = (): string | null => active;

export function setActiveHouseholdId(id: string | null): void {
	active = id;
	try {
		if (id) window.localStorage.setItem(KEY, id);
		else window.localStorage.removeItem(KEY);
	} catch {
		// storage unavailable: the choice only lasts until the page is reloaded
	}
}
