// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOpenApi } from "./openapi.js";
import { allRoutes } from "./routes/index.js";
import { createHousehold, createTestContext, type TestContext } from "./test/helpers.js";

const spec = buildOpenApi(allRoutes) as {
	openapi: string;
	paths: Record<
		string,
		Record<string, { parameters?: { name: string }[]; requestBody?: unknown; responses: Record<string, unknown> }>
	>;
};

describe("spec OpenAPI", () => {
	it("openapi.json is up to date (run `pnpm --filter @lumo/api openapi:generate` otherwise)", () => {
		const file = fileURLToPath(new URL("../openapi.json", import.meta.url));
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(spec)));
	});

	it("describes every step 2 route", () => {
		expect(spec.openapi).toBe("3.1.0");
		for (const [path, method] of [
			["/api/v1/me", "get"],
			["/api/v1/items", "post"],
			["/api/v1/items/{id}", "patch"],
			["/api/v1/items/{id}", "delete"],
			["/api/v1/today", "get"],
			["/api/v1/items/{id}/completions", "post"],
			["/api/v1/completions/{id}", "delete"],
			["/api/v1/rewards", "get"],
			["/api/v1/rewards/{id}/redemptions", "post"],
			["/api/v1/transfers", "post"],
			["/api/v1/ledger", "get"],
			["/api/v1/ledger/adjustments", "post"],
			["/api/v1/stats", "get"],
		] as const) {
			expect(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined();
		}
	});

	it("requires Idempotency-Key on coin writes, not on reads", () => {
		const names = (path: string, method: string) => spec.paths[path]?.[method]?.parameters?.map((p) => p.name) ?? [];
		expect(names("/api/v1/items/{id}/completions", "post")).toContain("Idempotency-Key");
		expect(names("/api/v1/transfers", "post")).toContain("Idempotency-Key");
		expect(names("/api/v1/ledger", "get")).not.toContain("Idempotency-Key");
	});

	it("no completion route accepts an amount", () => {
		const body = JSON.stringify(spec.paths["/api/v1/items/{id}/completions"]?.post?.requestBody);
		expect(body).not.toContain("amount");
		expect(body).toContain('"additionalProperties":false');
	});
});

describe("GET /api/v1/openapi.json", () => {
	let ctx: TestContext;
	beforeEach(async () => {
		ctx = await createTestContext();
	});
	afterEach(async () => {
		await ctx.close();
	});

	it("serves the same spec to a signed-in member", async () => {
		const h = await createHousehold(ctx);
		const res = await h.owner.api.get("/openapi.json");
		expect(res.statusCode).toBe(200);
		expect(res.json().paths).toEqual(JSON.parse(JSON.stringify(spec.paths)));
	});
});
