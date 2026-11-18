// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { assertFeature, can, featureOfItem, scheduleSchema } from "@lumo/domain";
import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { itemAssignees, items, memberships } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import type { createItemBody, itemView, updateItemBody } from "../schemas.js";
import type { ActorCtx } from "./context.js";
import { actorIn, requireRight } from "./context.js";
import type { DbOrTx, Tx } from "./members.js";

export type ItemRow = typeof items.$inferSelect;
type ItemView = z.input<typeof itemView>;

const notFound = () => new AppError(404, "not_found", "Item not found");

export function assigneesOf(db: DbOrTx, itemIds: string[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	if (itemIds.length === 0) return map;
	for (const r of db.select().from(itemAssignees).where(inArray(itemAssignees.itemId, itemIds)).all()) {
		map.set(r.itemId, [...(map.get(r.itemId) ?? []), r.userId]);
	}
	return map;
}

export function toItemView(row: ItemRow, assigneeIds: string[]): ItemView {
	return {
		id: row.id,
		kind: row.kind,
		name: row.name,
		description: row.description,
		schedule: row.schedule == null ? null : scheduleSchema.parse(row.schedule),
		targetPerPeriod: row.targetPerPeriod,
		reward: row.reward,
		creditsTo: row.creditsTo,
		dueAt: row.dueAt?.toISOString() ?? null,
		pinned: row.pinned,
		requiresApproval: row.requiresApproval,
		archivedAt: row.archivedAt?.toISOString() ?? null,
		createdBy: row.createdBy,
		assigneeIds,
		scope: row.householdId ? "household" : "personal",
		householdId: row.householdId,
	};
}

/**
 * Items the actor can see: their own personal items, and those of their households, except the kinds a household
 * turned off (hidden, not deleted: they come back if the feature is switched on again).
 */
export function accessibleItems(actor: ActorCtx): SQL | undefined {
	const perHousehold = actor.memberships.flatMap((m) => {
		const kinds = [
			...(m.features.habits ? (["habit"] as const) : []),
			...(m.features.tasks ? (["task"] as const) : []),
		];
		return kinds.length > 0 ? [and(eq(items.householdId, m.householdId), inArray(items.kind, kinds))] : [];
	});
	return or(eq(items.ownerId, actor.userId), ...perHousehold);
}

/** Item of the actor (personal) or of their household, not archived; otherwise 404 (nothing is revealed about others). */
export function getActiveItem(db: DbOrTx, actor: ActorCtx, id: string): ItemRow {
	const row = db
		.select()
		.from(items)
		.where(and(eq(items.id, id), accessibleItems(actor)))
		.get();
	if (!row || row.archivedAt) throw notFound();
	return row;
}

function assertMembers(db: DbOrTx, householdId: string, ids: string[]) {
	const found = db
		.select({ id: memberships.userId })
		.from(memberships)
		.where(and(eq(memberships.householdId, householdId), inArray(memberships.userId, ids)))
		.all();
	if (found.length !== ids.length) throw errors.validation("assigneeIds: an assignee is not a member of the household");
}

const unique = (ids: string[]) => [...new Set(ids)];

export function createItem(tx: Tx, actor: ActorCtx, input: z.output<typeof createItemBody>, now: Date): ItemView {
	requireRight(actor, "create");
	const scope = input.scope ?? (actor.householdId ? "household" : "personal");
	const householdId = scope === "household" ? (input.householdId ?? actor.householdId) : null;
	if (scope === "household" && !householdId) throw errors.noHousehold();
	// Rights come from the household the item will belong to.
	const as = actorIn(actor, householdId);
	if (householdId) {
		assertFeature(as.features, featureOfItem(input.kind));
		if (input.creditsTo === "shared") assertFeature(as.features, "pot");
	}
	const assigneeIds = unique(input.assigneeIds ?? [actor.userId]);
	if (!can(as, "item:create", { assigneeIds })) throw errors.forbidden("Creation not allowed");
	if (householdId === null) {
		// A personal item is yours alone: nobody to assign, no approval, and only your own coins.
		if (assigneeIds.some((id) => id !== actor.userId))
			throw errors.validation("assigneeIds: a personal item is yours alone");
		if (input.creditsTo !== "personal") throw errors.validation("creditsTo: a personal item credits your own coins");
		if (input.requiresApproval) throw errors.validation("requiresApproval: not for personal items");
	} else {
		assertMembers(tx, householdId, assigneeIds);
	}

	const id = randomUUID();
	tx.insert(items)
		.values({
			id,
			householdId,
			ownerId: householdId === null ? actor.userId : null,
			kind: input.kind,
			name: input.name,
			description: input.description ?? null,
			schedule: input.kind === "habit" ? input.schedule : null,
			targetPerPeriod: input.kind === "habit" ? input.targetPerPeriod : 1,
			reward: input.reward,
			creditsTo: input.creditsTo,
			dueAt: input.kind === "task" && input.dueAt ? new Date(input.dueAt) : null,
			pinned: input.pinned,
			requiresApproval: input.requiresApproval,
			createdBy: actor.userId,
			createdAt: now,
		})
		.run();
	tx.insert(itemAssignees)
		.values(assigneeIds.map((userId) => ({ itemId: id, userId })))
		.run();
	const row = tx.select().from(items).where(eq(items.id, id)).get() as ItemRow;
	return toItemView(row, assigneeIds);
}

/** Your personal items, plus those of every household you belong to. */
export function listItems(db: DbOrTx, actor: ActorCtx, includeArchived: boolean): ItemView[] {
	const rows = db
		.select()
		.from(items)
		.where(and(accessibleItems(actor), includeArchived ? undefined : isNull(items.archivedAt)))
		.all();
	rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, "fr"));
	const assignees = assigneesOf(
		db,
		rows.map((r) => r.id),
	);
	return rows.map((r) => toItemView(r, assignees.get(r.id) ?? []));
}

export function updateItem(tx: Tx, actor: ActorCtx, id: string, input: z.output<typeof updateItemBody>): ItemView {
	requireRight(actor, "modify");
	const row = getActiveItem(tx, actor, id);
	const as = actorIn(actor, row.householdId);
	if (row.householdId && input.creditsTo === "shared") assertFeature(as.features, "pot");
	if (!can(as, "item:update", { createdBy: row.createdBy })) throw errors.forbidden("Update not allowed");
	if (row.kind === "task" && input.schedule) throw errors.validation("body.schedule: a task has no schedule");
	if (row.kind === "habit" && input.dueAt !== undefined) throw errors.validation("body.dueAt: tasks only");

	if (!row.householdId) {
		if (input.assigneeIds) throw errors.validation("assigneeIds: a personal item is yours alone");
		if (input.creditsTo === "shared") throw errors.validation("creditsTo: a personal item credits your own coins");
		if (input.requiresApproval) throw errors.validation("requiresApproval: not for personal items");
	}
	if (input.assigneeIds && row.householdId) {
		const assigneeIds = unique(input.assigneeIds);
		if (!can(as, "item:create", { assigneeIds })) throw errors.forbidden("Assignment not allowed");
		assertMembers(tx, row.householdId, assigneeIds);
		tx.delete(itemAssignees).where(eq(itemAssignees.itemId, id)).run();
		tx.insert(itemAssignees)
			.values(assigneeIds.map((userId) => ({ itemId: id, userId })))
			.run();
	}

	const patch: Partial<typeof items.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) patch.description = input.description;
	if (input.schedule !== undefined) patch.schedule = input.schedule;
	if (input.targetPerPeriod !== undefined && row.kind === "habit") patch.targetPerPeriod = input.targetPerPeriod;
	if (input.reward !== undefined) patch.reward = input.reward;
	if (input.creditsTo !== undefined) patch.creditsTo = input.creditsTo;
	if (input.dueAt !== undefined) patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
	if (input.pinned !== undefined) patch.pinned = input.pinned;
	if (input.requiresApproval !== undefined) patch.requiresApproval = input.requiresApproval;
	if (Object.keys(patch).length > 0) tx.update(items).set(patch).where(eq(items.id, id)).run();

	const fresh = tx.select().from(items).where(eq(items.id, id)).get() as ItemRow;
	return toItemView(fresh, assigneesOf(tx, [id]).get(id) ?? []);
}

/** Archiving (never deleted: the coin history stays readable). Idempotent. */
export function archiveItem(tx: Tx, actor: ActorCtx, id: string, now: Date): void {
	requireRight(actor, "delete");
	const row = tx
		.select()
		.from(items)
		.where(and(eq(items.id, id), accessibleItems(actor)))
		.get();
	if (!row) throw notFound();
	if (!can(actorIn(actor, row.householdId), "item:update", { createdBy: row.createdBy })) {
		throw errors.forbidden("Archiving not allowed");
	}
	if (!row.archivedAt) tx.update(items).set({ archivedAt: now }).where(eq(items.id, id)).run();
}
