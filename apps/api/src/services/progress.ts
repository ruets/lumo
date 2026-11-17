// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	addDays,
	compareDates,
	computeStreaks,
	type DailyCounts,
	daysBetween,
	isDue,
	localDate,
	periodStats,
	scheduleSchema,
} from "@lumo/domain";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { completions, itemAssignees, items } from "../db/schema.js";
import { errors } from "../errors.js";
import type { statsView, todayView } from "../schemas.js";
import { countActive } from "./completions.js";
import type { ActorCtx } from "./context.js";
import { assigneesOf, type ItemRow, toItemView } from "./items.js";
import type { DbOrTx } from "./members.js";

function assignedItems(db: DbOrTx, actor: ActorCtx): ItemRow[] {
	const ids = db
		.select({ id: itemAssignees.itemId })
		.from(itemAssignees)
		.where(eq(itemAssignees.userId, actor.userId))
		.all()
		.map((r) => r.id);
	if (ids.length === 0) return [];
	return db
		.select()
		.from(items)
		.where(and(inArray(items.id, ids), eq(items.householdId, actor.householdId), isNull(items.archivedAt)))
		.all();
}

/** "Today" screen: items due that day (or tasks to do) with their progress. */
export function getToday(db: DbOrTx, actor: ActorCtx, date: string | undefined, now: Date): z.input<typeof todayView> {
	const day = date ?? localDate(now, actor.timezone);
	const rows = assignedItems(db, actor);
	const assignees = assigneesOf(
		db,
		rows.map((r) => r.id),
	);

	const entries = [];
	for (const item of rows) {
		const onDay = (status: "approved" | "pending") =>
			db
				.select({ id: completions.id })
				.from(completions)
				.where(
					and(
						eq(completions.itemId, item.id),
						eq(completions.userId, actor.userId),
						eq(completions.localDate, day),
						isNull(completions.undoneAt),
						eq(completions.status, status),
					),
				)
				.orderBy(desc(completions.completedAt))
				.all()
				.map((r) => r.id);
		const approvedIds = onDay("approved");
		const pendingIds = onDay("pending");
		const approved = approvedIds.length;
		const pending = pendingIds.length;

		if (item.kind === "habit") {
			if (!isDue(scheduleSchema.parse(item.schedule), day)) continue;
		} else if (countActive(db, item.id, actor.userId, null) > 0 && approved + pending === 0) {
			continue; // task already done on another day
		}
		entries.push({
			item: toItemView(item, assignees.get(item.id) ?? []),
			approved,
			pending,
			target: item.targetPerPeriod,
			done: approved >= item.targetPerPeriod,
			// Undoable completions of the day; the client undoes the first one.
			completionIds: [...pendingIds, ...approvedIds],
		});
	}
	entries.sort((a, b) => Number(b.item.pinned) - Number(a.item.pinned) || a.item.name.localeCompare(b.item.name, "fr"));
	return { date: day, items: entries };
}

const MAX_RANGE_DAYS = 366;

/** Streaks, rates (last 7 and 30 days) and heatmap of the actor's habits. Only approved completions count. */
export function getStats(
	db: DbOrTx,
	actor: ActorCtx,
	q: { from?: string | undefined; to?: string | undefined },
	now: Date,
): z.input<typeof statsView> {
	const today = localDate(now, actor.timezone);
	const to = q.to ?? today;
	const from = q.from ?? addDays(to, -29);
	if (compareDates(from, to) > 0) throw errors.validation("query: from must come before to");
	if (daysBetween(from, to) > MAX_RANGE_DAYS) throw errors.validation(`query: range limited to ${MAX_RANGE_DAYS} days`);

	const habits = assignedItems(db, actor).filter((i) => i.kind === "habit");
	const counts = new Map<string, Record<string, number>>();
	if (habits.length) {
		const rows = db
			.select()
			.from(completions)
			.where(
				and(
					eq(completions.userId, actor.userId),
					inArray(
						completions.itemId,
						habits.map((h) => h.id),
					),
					isNull(completions.undoneAt),
					eq(completions.status, "approved"),
				),
			)
			.all();
		for (const r of rows) {
			const perDate = counts.get(r.itemId) ?? {};
			perDate[r.localDate] = (perDate[r.localDate] ?? 0) + 1;
			counts.set(r.itemId, perDate);
		}
	}

	const prepared = habits.map((item) => {
		const schedule = scheduleSchema.parse(item.schedule);
		const perDate: DailyCounts = counts.get(item.id) ?? {};
		const created = localDate(item.createdAt, actor.timezone);
		const earliest = Object.keys(perDate).sort()[0];
		const since = earliest && compareDates(earliest, created) < 0 ? earliest : created;
		return { item, schedule, perDate, created, since };
	});

	const stats = prepared.map(({ item, schedule, perDate, since }) => {
		const input = { schedule, targetPerDay: item.targetPerPeriod, weekStart: actor.weekStart, counts: perDate };
		return {
			itemId: item.id,
			name: item.name,
			streak: computeStreaks({ ...input, from: since, today }),
			week: periodStats({ ...input, from: addDays(today, -6), to: today, today }),
			month: periodStats({ ...input, from: addDays(today, -29), to: today, today }),
		};
	});

	const heatmap = [];
	const end = compareDates(to, today) > 0 ? today : to;
	for (let d = from; compareDates(d, end) <= 0; d = addDays(d, 1)) {
		let done = 0;
		let expected = 0;
		for (const p of prepared) {
			if (compareDates(d, p.created) < 0 || p.schedule.type === "timesPerWeek" || !isDue(p.schedule, d)) continue;
			expected++;
			if ((p.perDate[d] ?? 0) >= p.item.targetPerPeriod) done++;
		}
		heatmap.push({ date: d, done, expected });
	}
	return { from, to, habits: stats, heatmap };
}
