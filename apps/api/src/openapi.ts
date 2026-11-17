// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import type { RouteDef } from "./routes/define.js";

type Json = Record<string, unknown>;

function schemaOf(schema: z.ZodType, io: "input" | "output"): Json {
	const { $schema: _omit, ...rest } = z.toJSONSchema(schema, {
		io,
		unrepresentable: "any",
		target: "draft-2020-12",
	}) as Json;
	return rest;
}

const problem = {
	description: "Erreur (RFC 9457), avec un `code` stable",
	content: {
		"application/problem+json": {
			schema: {
				type: "object",
				required: ["type", "title", "status", "code"],
				properties: {
					type: { type: "string" },
					title: { type: "string" },
					status: { type: "integer" },
					code: { type: "string" },
					detail: { type: "string" },
					instance: { type: "string" },
				},
			},
		},
	},
};

/** Spec OpenAPI 3.1 des routes déclaratives, générée depuis les schémas Zod (aucune écriture à la main). */
export function buildOpenApi(routes: readonly RouteDef[]): Json {
	const paths: Record<string, Record<string, Json>> = {};
	for (const r of routes) {
		const url = `/api/v1${r.url.replace(/:(\w+)/g, "{$1}")}`;
		const parameters: Json[] = [];
		if (r.params) {
			const s = schemaOf(r.params, "input") as { properties?: Record<string, Json> };
			for (const [name, schema] of Object.entries(s.properties ?? {})) {
				parameters.push({ name, in: "path", required: true, schema });
			}
		}
		if (r.query) {
			const s = schemaOf(r.query, "input") as { properties?: Record<string, Json>; required?: string[] };
			for (const [name, schema] of Object.entries(s.properties ?? {})) {
				parameters.push({ name, in: "query", required: s.required?.includes(name) ?? false, schema });
			}
		}
		if (r.idempotent) {
			parameters.push({
				name: "Idempotency-Key",
				in: "header",
				required: true,
				description: "UUID unique par requête ; un doublon renvoie la réponse déjà enregistrée.",
				schema: { type: "string", maxLength: 200 },
			});
		}
		const success: Json = { description: r.status === 204 ? "Aucun contenu" : "Succès" };
		if (r.response && r.status !== 204) {
			success.content = { "application/json": { schema: schemaOf(r.response, "output") } };
		}
		const methods = paths[url] ?? {};
		paths[url] = methods;
		methods[r.method] = {
			summary: r.summary,
			tags: [r.tag],
			operationId: `${r.method}${url.replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""))}`,
			...(parameters.length ? { parameters } : {}),
			...(r.body
				? { requestBody: { required: true, content: { "application/json": { schema: schemaOf(r.body, "input") } } } }
				: {}),
			responses: { [String(r.status)]: success, default: problem },
			security: [{ session: [] }, { bearer: [] }],
		};
	}
	return {
		openapi: "3.1.0",
		info: {
			title: "Lumo API",
			version: "1.0.0",
			license: { name: "AGPL-3.0-or-later", identifier: "AGPL-3.0-or-later" },
			description:
				"API de Lumo. Le serveur est seul juge des pièces : aucun client n'envoie de montant. Les écritures portent un `Idempotency-Key`.",
		},
		servers: [{ url: "/" }],
		paths,
		components: {
			securitySchemes: {
				session: { type: "apiKey", in: "cookie", name: "lumo_session" },
				bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
			},
		},
	};
}
