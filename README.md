# Lumo

Gamified habit tracker for a household, self-hosted. AGPL-3.0 license. Full plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The app is available in English and French (more languages are easy to add, see the Internationalisation section of the plan). The language follows your browser or phone and can be changed in the app.

## Development

Requirements: Node 22, pnpm (via Corepack).

```bash
pnpm install
cp .env.example apps/api/.env   # then fill in SESSION_SECRET; PUBLIC_URL=http://localhost:5173
pnpm dev                        # API :3000 and web :5173 (the web app proxies /api)
```

On first launch, open http://localhost:5173: the screen offers to create the first account (a super admin) and its household or to sign in with Authentik if OIDC is configured.

```bash
pnpm lint        # Biome
pnpm typecheck
pnpm test        # Vitest (domain, i18n, mobile queue, API on a temporary SQLite file)
pnpm build
pnpm db:generate # new Drizzle migration after changing apps/api/src/db/schema.ts
pnpm --filter @lumo/api openapi:generate     # OpenAPI spec after a route change (checked by CI)
pnpm --filter @lumo/api-client generate      # typed client from the spec
```

Mobile: `cd apps/mobile && pnpm dev`. The app asks for the server address at first launch (a single APK serves every household); `EXPO_PUBLIC_API_URL` only pre-fills that field in development.

## Deployment

```bash
cp .env.example .env   # to fill in
docker compose up -d   # app + Litestream backup
```

CI publishes the single web + API image to `ghcr.io/<owner>/<repo>` (`edge` on every push to `main`, SemVer and `latest` on `vX.Y.Z` tags) and builds the Android APK (attached to the GitHub release on tags).

In Authentik: a single OIDC application (confidential client) with two redirect URIs, `PUBLIC_URL/api/v1/auth/callback` for the web and `lumo://auth` for mobile. Mobile never holds the secret: it gets the code through PKCE and the API exchanges it.

Optional: set `OIDC_ADMIN_GROUP` to the name of an Authentik group (for example `lumo-admins`) so its members become super admins when they sign in. Without it, nobody is promoted from their groups. Set `OIDC_AUTO_CREATE_USERS=true` to let anyone who can sign in with Authentik create their own account (no household, not supervised) on first sign-in; by default an account needs a code. The first account created on an instance is always a super admin; super admins manage accounts and households from the Administration page and never see household content.
