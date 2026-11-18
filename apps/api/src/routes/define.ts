// SPDX-License-Identifier: AGPL-3.0-or-later

import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { AuthContext } from "../auth/guard.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { idempotencyKeys } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import { type AccountCtx, type ActorCtx, type HouseholdActorCtx, loadAccount, loadActor } from "../services/context.js";
import { type Tx, writeTx } from "../services/members.js";
import { loadWardActor } from "../services/supervision.js";

/**
 * `household` routes need a household (403 `no_household` otherwise) and receive an actor that has one;
 * `account` routes work for any signed-in account, with or without a household.
 */
export type RouteScope = "household" | "account";

export interface RouteContext<B, Q, P, A = HouseholdActorCtx, X = undefined> {
	/** Write: the request's `BEGIN IMMEDIATE` transaction. Read: the database (same queries, no writes). */
	db: Tx;
	config: Config;
	/** The caller, with their household on household routes (`householdId` may be null on account routes). */
	actor: A;
	/** The caller's account (always set on account routes). */
	account: AccountCtx;
	body: B;
	query: Q;
	params: P;
	/** Result of the route's async `prepare` step (for work that cannot run inside the sync transaction). */
	prepared: X;
	now: Date;
}

export interface RouteDef {
	method: "get" | "post" | "patch" | "delete";
	url: string;
	summary: string;
	tag: string;
	body?: z.ZodType;
	query?: z.ZodType;
	params?: z.ZodType;
	response?: z.ZodType;
	scope: RouteScope;
	/** Runs for a ward (`/supervision/wards/:wardId/...`): the guardian acts on the ward's own space. */
	ward: boolean;
	/** Only super admins may call it (403 otherwise). */
	superAdmin: boolean;
	// biome-ignore lint/suspicious/noExplicitAny: typed by `route()`
	prepare?: (body: any) => Promise<unknown>;
	status: number;
	/** Write: run in a single transaction, `Idempotency-Key` required. */
	idempotent: boolean;
	// biome-ignore lint/suspicious/noExplicitAny: the fine-grained typing is carried by `route()`
	handler: (ctx: RouteContext<any, any, any, any, any>) => unknown;
}

type Out<T extends z.ZodType | undefined> = T extends z.ZodType ? z.output<T> : undefined;

/** Declares a route: the schemas type the handler and feed the OpenAPI spec. */
export function route<
	TB extends z.ZodType | undefined = undefined,
	TQ extends z.ZodType | undefined = undefined,
	TP extends z.ZodType | undefined = undefined,
	TR extends z.ZodType | undefined = undefined,
	S extends RouteScope = "household",
	X = undefined,
>(def: {
	/** Defaults to `household`. */
	scope?: S;
	/** Restricts the route to super admins. */
	superAdmin?: boolean;
	/** Async step run before the transaction (password hashing...); its result reaches the handler as `prepared`. */
	prepare?: (body: Out<TB>) => Promise<X>;
	method: RouteDef["method"];
	url: string;
	summary: string;
	tag: string;
	body?: TB;
	query?: TQ;
	params?: TP;
	response?: TR;
	status?: number;
	idempotent?: boolean;
	handler: (
		ctx: RouteContext<Out<TB>, Out<TQ>, Out<TP>, S extends "account" ? ActorCtx : HouseholdActorCtx, X>,
	) => // biome-ignore lint/suspicious/noConfusingVoidType: handlers without a body (204) return void
	TR extends z.ZodType ? z.input<TR> : undefined | void;
}): RouteDef {
	const write = def.method !== "get";
	return {
		method: def.method,
		url: def.url,
		summary: def.summary,
		tag: def.tag,
		...(def.body ? { body: def.body } : {}),
		...(def.query ? { query: def.query } : {}),
		...(def.params ? { params: def.params } : {}),
		...(def.response ? { response: def.response } : {}),
		scope: def.scope ?? "household",
		superAdmin: def.superAdmin ?? false,
		ward: false,
		...(def.prepare ? { prepare: def.prepare as RouteDef["prepare"] } : {}),
		status: def.status ?? 200,
		idempotent: def.idempotent ?? write,
		handler: def.handler as RouteDef["handler"],
	};
}

function parse<S extends z.ZodType>(schema: S | undefined, data: unknown, where: string): z.output<S> | undefined {
	if (!schema) return undefined;
	const result = schema.safeParse(data ?? {});
	if (!result.success) {
		const detail = result.error.issues.map(
			(i) => `${where}${i.path.length ? `.${i.path.join(".")}` : ""} : ${i.message}`,
		);
		throw errors.validation(detail.join("; "));
	}
	return result.data;
}

interface Deps {
	db: Db;
	config: Config;
	clock: () => Date;
	requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

type Stored = { status: number; body: unknown };

export function registerRoutes(
	app: FastifyInstance,
	{ db, config, clock, requireAuth }: Deps,
	defs: readonly RouteDef[],
) {
	for (const def of defs) {
		app.route({
			method: def.method.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE",
			url: def.url,
			preHandler: requireAuth,
			handler: async (req, reply) => {
				const { userId } = req.auth as AuthContext;
				const wardId = (req.params as Record<string, string> | undefined)?.wardId;
				const params = parse(def.params, req.params, "params");
				const query = parse(def.query, req.query, "query");
				const body = parse(def.body, req.body, "body");
				const now = clock();
				const prepared = def.prepare ? await def.prepare(body) : undefined;

				const run = (dbx: Tx) => {
					const account = loadAccount(dbx, userId);
					if (!account) throw errors.unauthenticated();
					if (def.superAdmin && !account.isSuperAdmin) throw errors.forbidden("Super admins only");
					const header = req.headers["x-household-id"];
					const preferred = typeof header === "string" ? header : null;
					// A guardian acting for a ward gets the ward's own space, free of the ward's supervision limits.
					const actor = def.ward
						? loadWardActor(dbx, userId, wardId as string, preferred)
						: loadActor(dbx, userId, preferred);
					if (!actor) throw errors.unauthenticated();
					if (def.scope === "household" && !actor.householdId) throw errors.noHousehold();
					return def.handler({ db: dbx, config, actor, account, body, query, params, prepared, now });
				};
				const reply_ = (r: Stored) => (r.status === 204 ? reply.code(204).send() : reply.code(r.status).send(r.body));

				if (def.method === "get") return reply_({ status: def.status, body: run(db as unknown as Tx) });

				if (!def.idempotent) {
					return reply_({ status: def.status, body: writeTx(db, (tx) => run(tx)) });
				}

				const key = req.headers["idempotency-key"];
				if (typeof key !== "string" || key.length === 0 || key.length > 200) {
					throw new AppError(
						400,
						"idempotency_key_required",
						"Idempotency-Key header required",
						"Provide one UUID per write request",
					);
				}
				// Lookup, execution and storage in the same transaction: a simultaneous replay doubles nothing.
				const outcome = writeTx(db, (tx) => {
					const previous = tx
						.select()
						.from(idempotencyKeys)
						.where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
						.get();
					if (previous) return { replayed: true, ...(previous.response as Stored) };
					const result = run(tx);
					const stored: Stored = {
						status: def.status,
						body: result === undefined ? null : JSON.parse(JSON.stringify(result)),
					};
					tx.insert(idempotencyKeys).values({ key, userId, response: stored, createdAt: now }).run();
					return { replayed: false, ...stored };
				});
				if (outcome.replayed) reply.header("idempotent-replayed", "true");
				return reply_(outcome);
			},
		});
	}
}
