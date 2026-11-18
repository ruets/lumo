// SPDX-License-Identifier: AGPL-3.0-or-later
import { addDays, scheduleSchema } from "@lumo/domain";
import { z } from "zod";

/**
 * Zod schemas for the API requests and responses: they validate input, type the handlers
 * and feed the OpenAPI spec. Bodies are `strict`: an unknown field (for example an
 * `amount` sent by a client) is rejected, never ignored.
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

// ---- Items -------------------------------------------------------------------------------

const itemCommon = {
	name: text(120),
	description: z.string().trim().max(1000).nullish(),
	reward: z.number().int().min(0).max(100_000).default(0),
	creditsTo: walletKind.default("personal"),
	pinned: z.boolean().default(false),
	requiresApproval: z.boolean().default(false),
	assigneeIds: assigneeIds.optional(),
	/** Defaults to the household when the account has one, personal otherwise. */
	scope: z.enum(["personal", "household"]).optional(),
	/** Which household, for a household item; defaults to the active one. */
	householdId: z.string().min(1).max(100).optional(),
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
			/** Ignored: a task is completed only once. */
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
	/** `personal`: belongs to the account alone; `household`: shared with the household. */
	scope: z.enum(["personal", "household"]),
	householdId: z.string().nullable(),
});

// ---- Completions ------------------------------------------------------------------------

/** Never an amount: the server computes the coins. */
export const completeBody = z.object({ date: localDateSchema.optional() }).strict();

export const pendingQuery = z.object({ status: z.literal("pending") });

/** `shared` is the household pot: `null` for an account in no household. */
export const balancesView = z.object({ personal: z.number().int(), shared: z.number().int().nullable() });

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

// ---- Wishes -----------------------------------------------------------------------------

const limitFields = {
	limitCount: z.number().int().min(1).max(1000).nullish(),
	limitPeriod: z.enum(["day", "week", "month", "year"]).nullish(),
};
const limitConsistent = (r: { limitCount?: number | null; limitPeriod?: string | null }) =>
	(r.limitCount == null) === (r.limitPeriod == null);
const LIMIT_MESSAGE = "limitCount and limitPeriod go together";

export const createRewardBody = z
	.object({
		name: text(120),
		description: z.string().trim().max(1000).nullish(),
		cost: z.number().int().min(1).max(1_000_000),
		fundedFrom: walletKind.default("personal"),
		/** Defaults to the household when the account has one, personal otherwise. */
		scope: z.enum(["personal", "household"]).optional(),
		/** Which household, for a household wish; defaults to the active one. */
		householdId: z.string().min(1).max(100).optional(),
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
	scope: z.enum(["personal", "household"]),
	householdId: z.string().nullable(),
	/** Redemptions still possible in the period (list only); `null`: no limit or not computed. */
	remaining: z.number().int().nullable(),
});

export const redemptionResult = z.object({
	redemption: z.object({
		id: z.string(),
		rewardId: z.string(),
		userId: z.string(),
		walletId: z.string(),
		redeemedAt: z.string(),
		undoneAt: z.string().nullable(),
	}),
	balances: balancesView,
});

// ---- Coins ------------------------------------------------------------------------------

export const transferBody = z.object({ amount: z.number() }).strict();

export const adjustmentBody = z
	.object({
		/** `null`: adjust the household pot. */
		userId: z.string().min(1).max(100).nullable(),
		amount: z
			.number()
			.int()
			.refine((n) => n !== 0, "the amount cannot be zero"),
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
	/** Name of the habit, task or wish concerned (completions, undos, redemptions). */
	label: z.string().nullable(),
});

// ---- Today and progress -------------------------------------------------------------

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
			/** Undoable completions of that day, for `DELETE /completions/{id}`. */
			completionIds: z.array(z.string()),
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

// ---- Profile and household --------------------------------------------------------------------

export const meView = z.object({
	user: z.object({ id: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }),
	/** The active household (the `X-Household-Id` one, else the oldest membership); `null` in none. */
	household: z.object({ id: z.string(), name: z.string() }).nullable(),
	role: z.enum(["owner", "adult", "child"]).nullable(),
	/** Every household of the account, with its role there and its pot. */
	households: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			role: z.enum(["owner", "adult", "child"]),
			pot: z.object({ id: z.string(), balance: z.number().int() }),
		}),
	),
	wallets: z.object({
		personal: z.object({ id: z.string(), balance: z.number().int() }),
		shared: z.object({ id: z.string(), balance: z.number().int() }).nullable(),
	}),
});

export const inviteBody = z.object({ role: z.enum(["adult", "child"]) }).strict();
export const inviteView = z.object({ token: z.string(), expiresAt: z.string() });

// ---- Household and members --------------------------------------------------------------

const roleEnum = z.enum(["owner", "adult", "child"]);

export const memberView = z.object({
	userId: z.string(),
	displayName: z.string(),
	role: roleEnum,
	canCreateItems: z.boolean(),
});

export const householdView = z.object({
	household: z.object({
		id: z.string(),
		name: z.string(),
		/** `null` = no limit. */
		backdateDays: z.number().int().nullable(),
	}),
	members: z.array(memberView),
	/** Pending invitations (owner only; empty for everyone else). The token is shown only once, at creation. */
	invites: z.array(z.object({ id: z.string(), role: roleEnum, expiresAt: z.string(), createdAt: z.string() })),
});

const isTimeZone = (tz: string) => {
	try {
		new Intl.DateTimeFormat("en", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
};

export const updateHouseholdBody = z
	.object({
		name: z.string().trim().min(1).max(80),
		/** How many days back anyone may complete something (an owner can always go further); `null` = no limit. */
		backdateDays: z.number().int().min(0).max(30).nullable(),
	})
	.partial()
	.strict()
	.refine((b) => Object.values(b).some((v) => v !== undefined), "provide at least one field");

export const updateMemberBody = z
	.object({ role: roleEnum, canCreateItems: z.boolean() })
	.partial()
	.strict()
	.refine((b) => b.role !== undefined || b.canCreateItems !== undefined, "provide role and/or canCreateItems");

// ---- Account (with or without a household) and administration ------------------------------

export const accountView = z.object({
	user: z.object({ id: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }),
	isSuperAdmin: z.boolean(),
	/** Every household of the account (possibly none). */
	households: z.array(z.object({ id: z.string(), name: z.string(), role: roleEnum })),
	timezone: z.string(),
	/** ISO weekday the week starts on: 1 = Monday … 7 = Sunday. */
	weekStart: z.number().int(),
	/** Whether this account may create a household (instance setting). */
	canCreateHousehold: z.boolean(),
});

export const removeMembershipParams = z.object({
	id: z.string().min(1).max(100),
	householdId: z.string().min(1).max(100),
});

export const householdIdView = z.object({ householdId: z.string() });

export const updateAccountBody = z
	.object({
		displayName: z.string().trim().min(1).max(80),
		timezone: z.string().min(1).max(64).refine(isTimeZone, "unknown time zone"),
		weekStart: z.number().int().min(1).max(7),
	})
	.partial()
	.strict()
	.refine((b) => Object.values(b).some((v) => v !== undefined), "provide at least one field");

export const createHouseholdBody = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const joinHouseholdBody = z.object({ code: z.string().min(10).max(200) }).strict();

export const adminUserView = z.object({
	id: z.string(),
	displayName: z.string(),
	username: z.string().nullable(),
	/** Signs in through the identity provider. */
	oidc: z.boolean(),
	isSuperAdmin: z.boolean(),
	disabled: z.boolean(),
	households: z.array(z.object({ id: z.string(), name: z.string(), role: roleEnum })),
	createdAt: z.string(),
});
export const adminUsersView = z.object({ users: z.array(adminUserView) });

export const adminCreateUserBody = z
	.object({
		displayName: z.string().trim().min(1).max(80),
		username: z
			.string()
			.trim()
			.toLowerCase()
			.regex(/^[a-z0-9._-]{3,32}$/, "3 to 32 characters: letters, digits, dot, hyphen, underscore"),
		password: z.string().min(10).max(200),
	})
	.strict();

export const adminUpdateUserBody = z
	.object({ isSuperAdmin: z.boolean(), disabled: z.boolean() })
	.partial()
	.strict()
	.refine((b) => b.isSuperAdmin !== undefined || b.disabled !== undefined, "provide isSuperAdmin and/or disabled");

export const adminAssignHouseholdBody = z.object({ householdId: z.string().min(1).max(100), role: roleEnum }).strict();

export const adminHouseholdView = z.object({
	id: z.string(),
	name: z.string(),
	memberCount: z.number().int(),
	createdAt: z.string(),
});
export const adminHouseholdsView = z.object({ households: z.array(adminHouseholdView) });
export const adminHouseholdBody = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const potAdjustmentBody = z
	.object({
		amount: z
			.number()
			.int()
			.refine((n) => n !== 0, "the amount cannot be zero"),
		note: text(500),
	})
	.strict();
export const potBalanceView = z.object({ balance: z.number().int() });

export const instanceSettingsView = z.object({ householdCreation: z.enum(["anyone", "admins"]) });
export const updateInstanceSettingsBody = z
	.object({ householdCreation: z.enum(["anyone", "admins"]) })
	.partial()
	.strict()
	.refine((b) => b.householdCreation !== undefined, "provide at least one field");
