// SPDX-License-Identifier: AGPL-3.0-or-later

import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { AuthContext } from "../auth/guard.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { idempotencyKeys } from "../db/schema.js";
import { AppError, errors } from "../errors.js";
import { type ActorCtx, loadActor } from "../services/context.js";
import { type Tx, writeTx } from "../services/members.js";

export interface RouteContext<B, Q, P> {
	/** Write: the request's `BEGIN IMMEDIATE` transaction. Read: the database (same queries, no writes). */
	db: Tx;
	config: Config;
	actor: ActorCtx;
	body: B;
	query: Q;
	params: P;
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
	status: number;
	/** Write: run in a single transaction, `Idempotency-Key` required. */
	idempotent: boolean;
	// biome-ignore lint/suspicious/noExplicitAny: the fine-grained typing is carried by `route()`
	handler: (ctx: RouteContext<any, any, any>) => unknown;
}

type Out<T extends z.ZodType | undefined> = T extends z.ZodType ? z.output<T> : undefined;

/** Declares a route: the schemas type the handler and feed the OpenAPI spec. */
export function route<
	TB extends z.ZodType | undefined = undefined,
	TQ extends z.ZodType | undefined = undefined,
	TP extends z.ZodType | undefined = undefined,
	TR extends z.ZodType | undefined = undefined,
>(def: {
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
	// biome-ignore lint/suspicious/noConfusingVoidType: handlers without a body (204) return void
	handler: (ctx: RouteContext<Out<TB>, Out<TQ>, Out<TP>>) => TR extends z.ZodType ? z.input<TR> : undefined | void;
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
				const params = parse(def.params, req.params, "params");
				const query = parse(def.query, req.query, "query");
				const body = parse(def.body, req.body, "body");
				const now = clock();

				const run = (dbx: Tx) => {
					const actor = loadActor(dbx, userId);
					if (!actor) throw errors.unauthenticated();
					return def.handler({ db: dbx, config, actor, body, query, params, now });
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
