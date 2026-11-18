// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A person's "spaces": their personal space and each household they belong to. Items and wishes carry
 * `householdId` (null = personal); screens merge every space and can filter on one.
 */
export type SpaceFilter = "all" | "personal" | (string & {});

interface InSpace {
	householdId: string | null;
}

/** `all` shows everything, `personal` the personal space, otherwise the household with that id. */
export function inSpace(filter: SpaceFilter, x: InSpace): boolean {
	if (filter === "all") return true;
	if (filter === "personal") return x.householdId === null;
	return x.householdId === filter;
}

/** A filter naming a household the person left falls back to showing everything. */
export function effectiveFilter(filter: SpaceFilter, households: readonly { id: string }[]): SpaceFilter {
	if (filter === "all" || filter === "personal") return filter;
	return households.some((h) => h.id === filter) ? filter : "all";
}

/** Labels are only worth showing from two spaces on, i.e. as soon as the person is in a household. */
export const hasSeveralSpaces = (households: readonly unknown[]): boolean => households.length > 0;

/** Name of the space an item or wish belongs to, or `null` when there is a single space (no label needed). */
export function spaceLabel(
	x: InSpace,
	households: readonly { id: string; name: string }[],
	personalLabel: string,
): string | null {
	if (!hasSeveralSpaces(households)) return null;
	if (x.householdId === null) return personalLabel;
	return households.find((h) => h.id === x.householdId)?.name ?? null;
}
