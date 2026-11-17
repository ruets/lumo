// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const envSchema = z
	.object({
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		HOST: z.string().default("0.0.0.0"),
		PORT: z.coerce.number().int().min(1).max(65535).default(3000),
		LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
		DATABASE_PATH: z.string().min(1),
		PUBLIC_URL: z.url(),
		SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters long"),
		LOCAL_AUTH_ENABLED: bool.default(true),
		OIDC_ISSUER: z.url().optional(),
		OIDC_CLIENT_ID: z.string().min(1).optional(),
		OIDC_CLIENT_SECRET: z.string().min(1).optional(),
		/** Authentik group whose members become `owner`. Unset or empty = disabled (opt-in). */
		OIDC_ADMIN_GROUP: z
			.string()
			.trim()
			.transform((v) => v || undefined)
			.optional(),
		/** Folder of the web build to serve; unset = no front end served. */
		WEB_DIST_PATH: z.string().optional(),
	})
	.superRefine((env, ctx) => {
		const oidc = [env.OIDC_ISSUER, env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET];
		const set = oidc.filter(Boolean).length;
		if (set !== 0 && set !== 3) {
			ctx.addIssue({
				code: "custom",
				message: "OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET go together",
			});
		}
		if (set === 0 && !env.LOCAL_AUTH_ENABLED) {
			ctx.addIssue({
				code: "custom",
				message: "No sign-in method: configure OIDC or enable LOCAL_AUTH_ENABLED",
			});
		}
	});

export type Config = z.infer<typeof envSchema> & {
	oidcEnabled: boolean;
	secureCookies: boolean;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	// An empty variable (common with docker-compose: `OIDC_ISSUER=`) counts as unset.
	const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
	const parsed = envSchema.safeParse(cleaned);
	if (!parsed.success) {
		const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"} : ${i.message}`);
		throw new Error(`Configuration invalide :\n${lines.join("\n")}`);
	}
	const cfg = parsed.data;
	return {
		...cfg,
		oidcEnabled: Boolean(cfg.OIDC_ISSUER),
		secureCookies: cfg.PUBLIC_URL.startsWith("https://"),
	};
}
