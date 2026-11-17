// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { can, scheduleSchema } from "@lumo/domain";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import { itemAssignees, items, memberships } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import type { createItemBody, itemView, updateItemBody } from "../schemas.js";
import type { ActorCtx } from "./context.js";
import type { DbOrTx, Tx } from "./members.js";

export type ItemRow = typeof items.$inferSelect;
type ItemView = z.input<typeof itemView>;

const notFound = () => new AppError(404, "not_found", "Élément introuvable");

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
	};
}

/** Élément du foyer de l'acteur, non archivé ; sinon 404 (on ne révèle rien d'un autre foyer). */
export function getActiveItem(db: DbOrTx, actor: ActorCtx, id: string): ItemRow {
	const row = db
		.select()
		.from(items)
		.where(and(eq(items.id, id), eq(items.householdId, actor.householdId)))
		.get();
	if (!row || row.archivedAt) throw notFound();
	return row;
}

function assertMembers(db: DbOrTx, actor: ActorCtx, ids: string[]) {
	const found = db
		.select({ id: memberships.userId })
		.from(memberships)
		.where(and(eq(memberships.householdId, actor.householdId), inArray(memberships.userId, ids)))
		.all();
	if (found.length !== ids.length) throw errors.validation("assigneeIds : un assigné n'est pas membre du foyer");
}

const unique = (ids: string[]) => [...new Set(ids)];

export function createItem(tx: Tx, actor: ActorCtx, input: z.output<typeof createItemBody>, now: Date): ItemView {
	const assigneeIds = unique(input.assigneeIds ?? [actor.userId]);
	if (!can(actor, "item:create", { assigneeIds })) throw errors.forbidden("Création non autorisée");
	assertMembers(tx, actor, assigneeIds);

	const id = randomUUID();
	tx.insert(items)
		.values({
			id,
			householdId: actor.householdId,
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

/** Owner et adultes voient tout ; un enfant ne voit que ce qui lui est assigné ou qu'il a créé. */
export function listItems(db: DbOrTx, actor: ActorCtx, includeArchived: boolean): ItemView[] {
	const base = and(eq(items.householdId, actor.householdId), includeArchived ? undefined : isNull(items.archivedAt));
	let rows: ItemRow[];
	if (actor.role === "child") {
		const mine = db
			.select({ id: itemAssignees.itemId })
			.from(itemAssignees)
			.where(eq(itemAssignees.userId, actor.userId))
			.all()
			.map((r) => r.id);
		rows = db
			.select()
			.from(items)
			.where(and(base, or(eq(items.createdBy, actor.userId), mine.length ? inArray(items.id, mine) : undefined)))
			.all();
	} else {
		rows = db.select().from(items).where(base).all();
	}
	rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, "fr"));
	const assignees = assigneesOf(
		db,
		rows.map((r) => r.id),
	);
	return rows.map((r) => toItemView(r, assignees.get(r.id) ?? []));
}

export function updateItem(tx: Tx, actor: ActorCtx, id: string, input: z.output<typeof updateItemBody>): ItemView {
	const row = getActiveItem(tx, actor, id);
	if (!can(actor, "item:update", { createdBy: row.createdBy })) throw errors.forbidden("Modification non autorisée");
	if (row.kind === "task" && input.schedule) throw errors.validation("body.schedule : une tâche n'a pas de récurrence");
	if (row.kind === "habit" && input.dueAt !== undefined) throw errors.validation("body.dueAt : réservé aux tâches");

	if (input.assigneeIds) {
		const assigneeIds = unique(input.assigneeIds);
		if (!can(actor, "item:create", { assigneeIds })) throw errors.forbidden("Assignation non autorisée");
		assertMembers(tx, actor, assigneeIds);
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

/** Archivage (jamais de suppression : l'historique des pièces reste lisible). Idempotent. */
export function archiveItem(tx: Tx, actor: ActorCtx, id: string, now: Date): void {
	const row = tx
		.select()
		.from(items)
		.where(and(eq(items.id, id), eq(items.householdId, actor.householdId)))
		.get();
	if (!row) throw notFound();
	if (!can(actor, "item:update", { createdBy: row.createdBy })) throw errors.forbidden("Archivage non autorisé");
	if (!row.archivedAt) tx.update(items).set({ archivedAt: now }).where(eq(items.id, id)).run();
}
