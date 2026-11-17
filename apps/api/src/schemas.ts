// SPDX-License-Identifier: AGPL-3.0-or-later
import { addDays, scheduleSchema } from "@lumo/domain";
import { z } from "zod";

/**
 * Schémas Zod des requêtes et réponses de l'API : ils valident les entrées, typent les handlers
 * et alimentent la spec OpenAPI. Les corps sont `strict` : un champ inconnu (par exemple un
 * `amount` envoyé par un client) est refusé, jamais ignoré.
 */

export const localDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "format attendu : AAAA-MM-JJ")
	.refine((d) => {
		try {
			addDays(d, 0);
			return true;
		} catch {
			return false;
		}
	}, "date inexistante");

export const idParams = z.object({ id: z.string().min(1).max(100) });
const walletKind = z.enum(["personal", "shared"]);
const text = (max: number) => z.string().trim().min(1).max(max);
const assigneeIds = z.array(z.string().min(1).max(100)).min(1).max(30);

// ---- Éléments ---------------------------------------------------------------------------

const itemCommon = {
	name: text(120),
	description: z.string().trim().max(1000).nullish(),
	reward: z.number().int().min(0).max(100_000).default(0),
	creditsTo: walletKind.default("personal"),
	pinned: z.boolean().default(false),
	requiresApproval: z.boolean().default(false),
	assigneeIds: assigneeIds.optional(),
};

export const createItemBody = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("habit"),
			schedule: scheduleSchema,
			targetPerPeriod: z.number().int().min(1).max(100).default(1),
			...itemCommon,
		})
		.strict(),
	z
		.object({
			kind: z.literal("task"),
			dueAt: z.iso.datetime().nullish(),
			/** Ignoré : une tâche se valide une seule fois. */
			targetPerPeriod: z.number().int().optional(),
			...itemCommon,
		})
		.strict(),
]);

export const updateItemBody = z
	.object({
		name: text(120),
		description: z.string().trim().max(1000).nullable(),
		schedule: scheduleSchema,
		targetPerPeriod: z.number().int().min(1).max(100),
		reward: z.number().int().min(0).max(100_000),
		creditsTo: walletKind,
		dueAt: z.iso.datetime().nullable(),
		pinned: z.boolean(),
		requiresApproval: z.boolean(),
		assigneeIds,
	})
	.partial()
	.strict();

export const listItemsQuery = z.object({
	includeArchived: z
		.enum(["true", "false"])
		.default("false")
		.transform((v) => v === "true"),
});

export const itemView = z.object({
	id: z.string(),
	kind: z.enum(["habit", "task"]),
	name: z.string(),
	description: z.string().nullable(),
	schedule: scheduleSchema.nullable(),
	targetPerPeriod: z.number().int(),
	reward: z.number().int(),
	creditsTo: walletKind,
	dueAt: z.string().nullable(),
	pinned: z.boolean(),
	requiresApproval: z.boolean(),
	archivedAt: z.string().nullable(),
	createdBy: z.string(),
	assigneeIds: z.array(z.string()),
});

// ---- Complétions ------------------------------------------------------------------------

/** Jamais de montant : le serveur calcule les pièces. */
export const completeBody = z.object({ date: localDateSchema.optional() }).strict();

export const pendingQuery = z.object({ status: z.literal("pending") });

export const balancesView = z.object({ personal: z.number().int(), shared: z.number().int() });

export const completionView = z.object({
	id: z.string(),
	itemId: z.string(),
	userId: z.string(),
	localDate: localDateSchema,
	status: z.enum(["pending", "approved", "rejected"]),
	approvedBy: z.string().nullable(),
	completedAt: z.string(),
	undoneAt: z.string().nullable(),
});

export const completionResult = z.object({ completion: completionView, balances: balancesView });

// ---- Envies -----------------------------------------------------------------------------

const limitFields = {
	limitCount: z.number().int().min(1).max(1000).nullish(),
	limitPeriod: z.enum(["day", "week", "month", "year"]).nullish(),
};
const limitConsistent = (r: { limitCount?: number | null; limitPeriod?: string | null }) =>
	(r.limitCount == null) === (r.limitPeriod == null);
const LIMIT_MESSAGE = "limitCount et limitPeriod vont ensemble";

export const createRewardBody = z
	.object({
		name: text(120),
		description: z.string().trim().max(1000).nullish(),
		cost: z.number().int().min(1).max(1_000_000),
		fundedFrom: walletKind.default("personal"),
		link: z.url().max(500).nullish(),
		assigneeIds: z.array(z.string().min(1).max(100)).max(30).default([]),
		...limitFields,
	})
	.strict()
	.refine(limitConsistent, LIMIT_MESSAGE);

export const updateRewardBody = z
	.object({
		name: text(120),
		description: z.string().trim().max(1000).nullable(),
		cost: z.number().int().min(1).max(1_000_000),
		fundedFrom: walletKind,
		link: z.url().max(500).nullable(),
		assigneeIds: z.array(z.string().min(1).max(100)).max(30),
		limitCount: z.number().int().min(1).max(1000).nullable(),
		limitPeriod: z.enum(["day", "week", "month", "year"]).nullable(),
		archived: z.boolean(),
	})
	.partial()
	.strict();

export const rewardView = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	cost: z.number().int(),
	fundedFrom: walletKind,
	limitCount: z.number().int().nullable(),
	limitPeriod: z.enum(["day", "week", "month", "year"]).nullable(),
	link: z.string().nullable(),
	archivedAt: z.string().nullable(),
	assigneeIds: z.array(z.string()),
});

export const redemptionResult = z.object({
	redemption: z.object({
		id: z.string(),
		rewardId: z.string(),
		userId: z.string(),
		walletId: z.string(),
		redeemedAt: z.string(),
	}),
	balances: balancesView,
});

// ---- Pièces -----------------------------------------------------------------------------

export const transferBody = z.object({ amount: z.number() }).strict();

export const adjustmentBody = z
	.object({
		/** `null` : ajuster la cagnotte du foyer. */
		userId: z.string().min(1).max(100).nullable(),
		amount: z
			.number()
			.int()
			.refine((n) => n !== 0, "le montant ne peut pas être nul"),
		note: text(500),
	})
	.strict();

export const ledgerQuery = z.object({
	wallet: walletKind.default("personal"),
	cursor: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ledgerEntryView = z.object({
	id: z.string(),
	walletId: z.string(),
	amount: z.number().int(),
	reason: z.enum(["completion", "undo", "redemption", "transfer", "adjustment"]),
	refId: z.string().nullable(),
	transferId: z.string().nullable(),
	note: z.string().nullable(),
	createdBy: z.string(),
	createdAt: z.string(),
});

// ---- Aujourd'hui et progrès -------------------------------------------------------------

export const todayQuery = z.object({ date: localDateSchema.optional() });

export const todayView = z.object({
	date: localDateSchema,
	items: z.array(
		z.object({
			item: itemView,
			approved: z.number().int(),
			pending: z.number().int(),
			target: z.number().int(),
			done: z.boolean(),
		}),
	),
});

export const statsQuery = z.object({ from: localDateSchema.optional(), to: localDateSchema.optional() });

const rateView = z.object({ done: z.number().int(), expected: z.number().int(), rate: z.number().nullable() });

export const statsView = z.object({
	from: localDateSchema,
	to: localDateSchema,
	habits: z.array(
		z.object({
			itemId: z.string(),
			name: z.string(),
			streak: z.object({ current: z.number().int(), best: z.number().int() }),
			week: rateView,
			month: rateView,
		}),
	),
	heatmap: z.array(z.object({ date: localDateSchema, done: z.number().int(), expected: z.number().int() })),
});

// ---- Profil et foyer --------------------------------------------------------------------

export const meView = z.object({
	user: z.object({ id: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }),
	household: z.object({ id: z.string(), name: z.string(), timezone: z.string() }),
	role: z.enum(["owner", "adult", "child"]),
	wallets: z.object({
		personal: z.object({ id: z.string(), balance: z.number().int() }),
		shared: z.object({ id: z.string(), balance: z.number().int() }),
	}),
});

export const inviteBody = z.object({ role: z.enum(["adult", "child"]) }).strict();
export const inviteView = z.object({ token: z.string(), expiresAt: z.string() });
