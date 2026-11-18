// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { DomainError } from "@lumo/domain";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import { createRequireAuth } from "./auth/guard.js";
import type { OidcProvider } from "./auth/oidc.js";
import { registerAuthRoutes } from "./auth/routes.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { AppError, errors, toProblem } from "./errors.js";
import { buildOpenApi } from "./openapi.js";
import { registerRoutes } from "./routes/define.js";
import { allRoutes } from "./routes/index.js";

export interface AppDeps {
	config: Config;
	db: Db;
	oidc: OidcProvider | null;
	logger?: FastifyServerOptions["logger"];
	/** Clock; injectable for tests (local days, date windows). */
	clock?: () => Date;
	/** Database availability check for `/readyz`. */
	ping?: () => void;
}

const DOMAIN_STATUS: Record<DomainError["code"], number> = {
	target_reached: 409,
	insufficient_balance: 409,
	limit_reached: 409,
	not_due: 409,
	invalid_amount: 400,
	future_date: 400,
	backdate_not_allowed: 403,
	last_owner: 409,
	cannot_remove_self: 409,
	cannot_target_self: 409,
	last_super_admin: 409,
	already_supervising: 409,
	guardian_cycle: 409,
	feature_disabled: 403,
};

export async function buildApp({
	config,
	db,
	oidc,
	logger = false,
	ping,
	clock = () => new Date(),
}: AppDeps): Promise<FastifyInstance> {
	const app = Fastify({
		logger,
		// The API runs behind the homelab reverse proxy.
		trustProxy: true,
		bodyLimit: 1024 * 1024,
	});

	await app.register(cookie);
	await app.register(rateLimit, { global: false });
	app.decorateRequest("auth", null);

	app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
		const send = (e: AppError) => reply.code(e.status).type("application/problem+json").send(toProblem(e, req.url));
		if (err instanceof AppError) return send(err);
		if (err instanceof DomainError) return send(new AppError(DOMAIN_STATUS[err.code], err.code, err.message));
		if (err instanceof ZodError) return send(errors.validation(err.message));
		const status = err.statusCode;
		if (status === 429) return send(new AppError(429, "rate_limited", "Too many requests, try again later"));
		if (status && status >= 400 && status < 500) {
			return send(new AppError(status, "bad_request", "Invalid request", err.message));
		}
		req.log.error({ err }, "internal error");
		return send(new AppError(500, "internal_error", "Internal error"));
	});

	app.get("/healthz", async () => ({ status: "ok" }));
	app.get("/readyz", async (_req, reply) => {
		try {
			ping?.();
			return { status: "ready" };
		} catch {
			return reply.code(503).send({ status: "unavailable" });
		}
	});

	const requireAuth = createRequireAuth(db, config);
	await app.register(
		async (api) => {
			registerAuthRoutes(api, { db, config, oidc, requireAuth });
			registerRoutes(api, { db, config, clock, requireAuth }, allRoutes);
			api.get("/openapi.json", async () => buildOpenApi(allRoutes));
		},
		{ prefix: "/api/v1" },
	);

	const webRoot = config.WEB_DIST_PATH ? resolve(config.WEB_DIST_PATH) : null;
	if (webRoot && existsSync(webRoot)) {
		await app.register(fastifyStatic, { root: webRoot, wildcard: false });
		app.setNotFoundHandler((req, reply) => {
			if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
			return reply
				.code(404)
				.type("application/problem+json")
				.send(toProblem(new AppError(404, "not_found", "Resource not found"), req.url));
		});
	} else {
		app.setNotFoundHandler((req, reply) =>
			reply
				.code(404)
				.type("application/problem+json")
				.send(toProblem(new AppError(404, "not_found", "Resource not found"), req.url)),
		);
	}

	return app;
}
