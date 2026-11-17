// SPDX-License-Identifier: AGPL-3.0-or-later
import type { TodayItem } from "@lumo/api-client";
import { scheduleLabel, shortDate, t } from "@lumo/i18n";

export function itemMeta(e: TodayItem): string {
	if (e.approved + e.pending >= e.target && !e.done) return t("items.pendingApproval");
	if (e.item.kind === "habit") return `${t("items.kind.habit")} · ${scheduleLabel(e.item.schedule)}`;
	if (e.item.dueAt)
		return `${t("items.kind.task")} · ${t("items.due", { date: shortDate(e.item.dueAt.slice(0, 10)) })}`;
	return t("items.kind.task");
}

/** Completed and waiting for an adult: nothing more for the member to do. */
export const awaitingReview = (e: TodayItem) => !e.done && e.approved + e.pending >= e.target;
