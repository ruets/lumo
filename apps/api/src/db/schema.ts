// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Schéma SQLite de Lumo (voir docs/ARCHITECTURE.md, « Modèle de données »).
 *
 * - Identifiants : UUID texte générés côté application.
 * - Horodatages : entiers en millisecondes Unix (UTC).
 * - `local_date` : texte `YYYY-MM-DD` dans le fuseau du foyer.
 * - Aucun solde stocké : un solde est la somme des `ledger_entries` d'un porte-monnaie.
 */

const id = () => text("id").primaryKey();
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAt = () => ts("created_at").notNull().default(sql`(unixepoch('subsec') * 1000)`);

export const ROLES = ["owner", "adult", "child"] as const;
export const ITEM_KINDS = ["habit", "task"] as const;
export const WALLET_KINDS = ["personal", "shared"] as const;
export const COMPLETION_STATUSES = ["pending", "approved", "rejected"] as const;
export const LEDGER_REASONS = ["completion", "undo", "redemption", "transfer", "adjustment"] as const;
export const LIMIT_PERIODS = ["day", "week", "month", "year"] as const;
export const SESSION_KINDS = ["web", "mobile"] as const;
export const PLATFORMS = ["android", "ios"] as const;

const inList = (column: string, values: readonly string[]) =>
	sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const households = sqliteTable(
	"households",
	{
		id: id(),
		name: text("name").notNull(),
		timezone: text("timezone").notNull().default("Europe/Paris"),
		/** 1 = lundi … 7 = dimanche (ISO). */
		weekStart: integer("week_start").notNull().default(1),
		backdateDays: integer("backdate_days").notNull().default(2),
		createdAt: createdAt(),
	},
	(t) => [
		check("households_week_start_check", sql`${t.weekStart} BETWEEN 1 AND 7`),
		check("households_backdate_days_check", sql`${t.backdateDays} >= 0`),
	],
);

export const users = sqliteTable(
	"users",
	{
		id: id(),
		displayName: text("display_name").notNull(),
		avatarUrl: text("avatar_url"),
		/** `sub` Authentik ; null pour un compte purement local. */
		oidcSubject: text("oidc_subject"),
		/** Compte local (secours) : identifiant de connexion, minuscules. */
		username: text("username"),
		email: text("email"),
		/** Hash Argon2id ; null pour un compte OIDC seul. */
		passwordHash: text("password_hash"),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("users_oidc_subject_uq").on(t.oidcSubject),
		uniqueIndex("users_username_uq").on(t.username),
		uniqueIndex("users_email_uq").on(t.email),
	],
);

export const memberships = sqliteTable(
	"memberships",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: text("role", { enum: ROLES }).notNull(),
		/** Un enfant peut-il créer ses propres éléments ? (« si autorisé ») */
		canCreateItems: integer("can_create_items", { mode: "boolean" }).notNull().default(false),
		createdAt: createdAt(),
	},
	(t) => [
		primaryKey({ columns: [t.householdId, t.userId] }),
		uniqueIndex("memberships_user_uq").on(t.userId),
		check("memberships_role_check", inList(t.role.name, ROLES)),
	],
);

export const wallets = sqliteTable(
	"wallets",
	{
		id: id(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id, { onDelete: "cascade" }),
		kind: text("kind", { enum: WALLET_KINDS }).notNull(),
		/** Null pour la cagnotte du foyer. */
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("wallets_personal_uq").on(t.householdId, t.userId),
		uniqueIndex("wallets_shared_uq").on(t.householdId).where(sql`${t.kind} = 'shared'`),
		check("wallets_kind_check", inList(t.kind.name, WALLET_KINDS)),
		check(
			"wallets_user_check",
			sql`(${t.kind} = 'personal' AND ${t.userId} IS NOT NULL) OR (${t.kind} = 'shared' AND ${t.userId} IS NULL)`,
		),
	],
);

export const items = sqliteTable(
	"items",
	{
		id: id(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id, { onDelete: "cascade" }),
		kind: text("kind", { enum: ITEM_KINDS }).notNull(),
		name: text("name").notNull(),
		description: text("description"),
		/** Récurrence validée par Zod dans `domain` : daily, weekly, timesPerWeek, monthly. Null pour une tâche. */
		schedule: text("schedule", { mode: "json" }),
		targetPerPeriod: integer("target_per_period").notNull().default(1),
		reward: integer("reward").notNull().default(0),
		creditsTo: text("credits_to", { enum: WALLET_KINDS }).notNull().default("personal"),
		dueAt: ts("due_at"),
		pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
		requiresApproval: integer("requires_approval", { mode: "boolean" }).notNull().default(false),
		archivedAt: ts("archived_at"),
		createdBy: text("created_by")
			.notNull()
			.references(() => users.id),
		createdAt: createdAt(),
	},
	(t) => [
		index("items_household_idx").on(t.householdId, t.archivedAt),
		check("items_kind_check", inList(t.kind.name, ITEM_KINDS)),
		check("items_credits_to_check", inList(t.creditsTo.name, WALLET_KINDS)),
		check("items_target_check", sql`${t.targetPerPeriod} >= 1`),
		check("items_reward_check", sql`${t.reward} >= 0`),
	],
);

export const itemAssignees = sqliteTable(
	"item_assignees",
	{
		itemId: text("item_id")
			.notNull()
			.references(() => items.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.itemId, t.userId] }), index("item_assignees_user_idx").on(t.userId)],
);

export const ledgerEntries = sqliteTable(
	"ledger_entries",
	{
		id: id(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id, { onDelete: "cascade" }),
		walletId: text("wallet_id")
			.notNull()
			.references(() => wallets.id),
		/** Entier signé, en pièces. */
		amount: integer("amount").notNull(),
		reason: text("reason", { enum: LEDGER_REASONS }).notNull(),
		/** Complétion, échange… à l'origine de l'écriture. */
		refId: text("ref_id"),
		/** Lie les deux écritures d'un virement. */
		transferId: text("transfer_id"),
		note: text("note"),
		createdBy: text("created_by")
			.notNull()
			.references(() => users.id),
		createdAt: createdAt(),
	},
	(t) => [
		index("ledger_entries_wallet_created_idx").on(t.walletId, t.createdAt),
		index("ledger_entries_transfer_idx").on(t.transferId),
		check("ledger_entries_reason_check", inList(t.reason.name, LEDGER_REASONS)),
		check("ledger_entries_amount_check", sql`${t.amount} <> 0`),
	],
);

export const completions = sqliteTable(
	"completions",
	{
		id: id(),
		itemId: text("item_id")
			.notNull()
			.references(() => items.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		localDate: text("local_date").notNull(),
		status: text("status", { enum: COMPLETION_STATUSES }).notNull().default("approved"),
		approvedBy: text("approved_by").references(() => users.id),
		completedAt: ts("completed_at").notNull(),
		/** Annuler pose `undone_at` ; la ligne n'est jamais supprimée. */
		undoneAt: ts("undone_at"),
		ledgerEntryId: text("ledger_entry_id").references(() => ledgerEntries.id),
	},
	(t) => [
		index("completions_item_user_date_idx").on(t.itemId, t.userId, t.localDate),
		check("completions_status_check", inList(t.status.name, COMPLETION_STATUSES)),
		check("completions_local_date_check", sql`${t.localDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
	],
);

export const rewards = sqliteTable(
	"rewards",
	{
		id: id(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		cost: integer("cost").notNull(),
		fundedFrom: text("funded_from", { enum: WALLET_KINDS }).notNull().default("personal"),
		limitCount: integer("limit_count"),
		limitPeriod: text("limit_period", { enum: LIMIT_PERIODS }),
		link: text("link"),
		archivedAt: ts("archived_at"),
		createdAt: createdAt(),
	},
	(t) => [
		index("rewards_household_idx").on(t.householdId, t.archivedAt),
		check("rewards_cost_check", sql`${t.cost} >= 0`),
		check("rewards_funded_from_check", inList(t.fundedFrom.name, WALLET_KINDS)),
		check(
			"rewards_limit_check",
			sql`(${t.limitCount} IS NULL AND ${t.limitPeriod} IS NULL) OR (${t.limitCount} >= 1 AND ${t.limitPeriod} IN ('day', 'week', 'month', 'year'))`,
		),
	],
);

export const rewardAssignees = sqliteTable(
	"reward_assignees",
	{
		rewardId: text("reward_id")
			.notNull()
			.references(() => rewards.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.rewardId, t.userId] })],
);

export const redemptions = sqliteTable(
	"redemptions",
	{
		id: id(),
		rewardId: text("reward_id")
			.notNull()
			.references(() => rewards.id),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		walletId: text("wallet_id")
			.notNull()
			.references(() => wallets.id),
		redeemedAt: ts("redeemed_at").notNull(),
		ledgerEntryId: text("ledger_entry_id")
			.notNull()
			.references(() => ledgerEntries.id),
	},
	(t) => [index("redemptions_reward_user_idx").on(t.rewardId, t.userId, t.redeemedAt)],
);

export const devices = sqliteTable(
	"devices",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		pushToken: text("push_token").notNull(),
		platform: text("platform", { enum: PLATFORMS }).notNull(),
		lastSeenAt: ts("last_seen_at").notNull(),
	},
	(t) => [
		uniqueIndex("devices_push_token_uq").on(t.pushToken),
		index("devices_user_idx").on(t.userId),
		check("devices_platform_check", inList(t.platform.name, PLATFORMS)),
	],
);

/**
 * Sessions : cookie web (`kind = 'web'`) ou refresh token mobile (`kind = 'mobile'`).
 * Le jeton en clair n'est jamais stocké, seulement son hash SHA-256.
 * `previous_token_hash` sert à détecter la réutilisation d'un refresh token déjà roté.
 */
export const sessions = sqliteTable(
	"sessions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		kind: text("kind", { enum: SESSION_KINDS }).notNull(),
		refreshTokenHash: text("refresh_token_hash").notNull(),
		previousTokenHash: text("previous_token_hash"),
		expiresAt: ts("expires_at").notNull(),
		deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
		createdAt: createdAt(),
		lastUsedAt: ts("last_used_at").notNull(),
	},
	(t) => [
		uniqueIndex("sessions_token_hash_uq").on(t.refreshTokenHash),
		index("sessions_user_idx").on(t.userId),
		index("sessions_expires_idx").on(t.expiresAt),
		check("sessions_kind_check", inList(t.kind.name, SESSION_KINDS)),
	],
);

export const idempotencyKeys = sqliteTable(
	"idempotency_keys",
	{
		key: text("key").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/** Réponse déjà rendue (statut + corps JSON). */
		response: text("response", { mode: "json" }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [primaryKey({ columns: [t.userId, t.key] }), index("idempotency_keys_created_idx").on(t.createdAt)],
);

/** Invitations : seul moyen de créer un compte (hors tout premier utilisateur). */
export const invites = sqliteTable(
	"invites",
	{
		id: id(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull(),
		role: text("role", { enum: ROLES }).notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => users.id),
		expiresAt: ts("expires_at").notNull(),
		usedAt: ts("used_at"),
		usedBy: text("used_by").references(() => users.id),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("invites_token_hash_uq").on(t.tokenHash),
		check("invites_role_check", inList(t.role.name, ROLES)),
	],
);

/** État temporaire d'une connexion OIDC web (PKCE + state + nonce). Purgé à l'usage ou à l'expiration. */
export const oidcStates = sqliteTable(
	"oidc_states",
	{
		state: text("state").primaryKey(),
		nonce: text("nonce").notNull(),
		codeVerifier: text("code_verifier").notNull(),
		/** Jeton d'invitation en clair, présent si la connexion crée un compte. */
		inviteToken: text("invite_token"),
		expiresAt: ts("expires_at").notNull(),
	},
	(t) => [index("oidc_states_expires_idx").on(t.expiresAt)],
);
