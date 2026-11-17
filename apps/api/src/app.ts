// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import { createRequireAuth } from "./auth/guard.js";
import type { OidcProvider } from "./auth/oidc.js";
import { registerAuthRoutes } from "./auth/routes.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { AppError, errors, toProblem } from "./errors.js";
import { registerMeRoutes } from "./routes/me.js";

export interface AppDeps {
	config: Config;
	db: Db;
	oidc: OidcProvider | null;
	logger?: FastifyServerOptions["logger"];
	/** Test de disponibilité de la base pour `/readyz`. */
	ping?: () => void;
}

export async function buildApp({ config, db, oidc, logger = false, ping }: AppDeps): Promise<FastifyInstance> {
	const app = Fastify({
		logger,
		// L'API tourne derrière le reverse proxy du homelab.
		trustProxy: true,
		bodyLimit: 1024 * 1024,
	});

	await app.register(cookie);
	await app.register(rateLimit, { global: false });
	app.decorateRequest("auth", null);

	app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
		const send = (e: AppError) => reply.code(e.status).type("application/problem+json").send(toProblem(e, req.url));
		if (err instanceof AppError) return send(err);
		if (err instanceof ZodError) return send(errors.validation(err.message));
		const status = err.statusCode;
		if (status === 429) return send(new AppError(429, "rate_limited", "Trop de requêtes, réessaie plus tard"));
		if (status && status >= 400 && status < 500) {
			return send(new AppError(status, "bad_request", "Requête invalide", err.message));
		}
		req.log.error({ err }, "erreur interne");
		return send(new AppError(500, "internal_error", "Erreur interne"));
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
			registerMeRoutes(api, db, requireAuth);
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
				.send(toProblem(new AppError(404, "not_found", "Ressource introuvable"), req.url));
		});
	} else {
		app.setNotFoundHandler((req, reply) =>
			reply
				.code(404)
				.type("application/problem+json")
				.send(toProblem(new AppError(404, "not_found", "Ressource introuvable"), req.url)),
		);
	}

	return app;
}
